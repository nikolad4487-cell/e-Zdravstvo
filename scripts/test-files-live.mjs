// Opt-in integration test for a development project. Creates one fictional PDF
// and archives it afterward; clinical retention means the original is retained.
import { createClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { randomUUID, createHash } from "node:crypto";
import assert from "node:assert/strict";
const {
  SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: key,
  DEMO_PASSWORD: password,
  ALLOW_DEMO_SEED: allow,
} = process.env;
if (!url || !key || !password || allow !== "true")
  throw new Error(
    "Requires .env, .env.seed and ALLOW_DEMO_SEED=true on a development project.",
  );
const pid = "40000000-0000-4000-8000-000000000001",
  requestId = randomUUID(),
  clients = [];
async function login(name) {
  const db = createClient(url, key, { auth: { persistSession: false } });
  clients.push(db);
  const r = await db.auth.signInWithPassword({
    email: name + "@demo.e-zdravstvo.test",
    password,
  });
  assert.equal(r.error, null);
  assert.equal(r.data.user.app_metadata.demo_seed, "e-zdravstvo-v1");
  return { db, token: r.data.session.access_token };
}
function request(token, body) {
  return fetch(url + "/functions/v1/document-files", {
    method: "POST",
    headers: {
      apikey: key,
      ...(token ? { Authorization: "Bearer " + token } : {}),
      ...(typeof body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
    },
    body,
  });
}
const pdf = await PDFDocument.create();
pdf.addPage().drawText("Fictional upload integration test. No medical data.");
const bytes = await pdf.save();
function form(payload = bytes) {
  const f = new FormData();
  f.set("patient_id", pid);
  f.set("request_id", requestId);
  f.set("title", "Automatska provjera privatnog prijenosa");
  f.set("category", "OTHER");
  f.set(
    "file",
    new File([payload], "integration-test.html", { type: "application/pdf" }),
  );
  return f;
}
const digest = (b) => createHash("sha256").update(b).digest("hex");
try {
  const patient = await login("pacijent");
  let response = await request(patient.token, form());
  assert.equal(response.status, 200);
  const { id } = await response.json();
  response = await request(patient.token, form());
  assert.equal(response.status, 200);
  assert.equal((await response.json()).id, id);
  const list = await patient.db.rpc("list_attachments", { patient_id: pid });
  assert.equal(list.error, null);
  assert.equal(
    list.data.find((a) => a.id === id).file_name,
    "integration-test.pdf",
  );
  response = await request(
    patient.token,
    form(new TextEncoder().encode("<script>invalid PDF</script>")),
  );
  assert.equal(response.status, 400);
  response = await request(
    patient.token,
    JSON.stringify({ attachment_id: id }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(
    digest(new Uint8Array(await response.arrayBuffer())),
    digest(bytes),
  );
  response = await request(null, JSON.stringify({ attachment_id: id }));
  assert.equal(response.status, 401);
  for (const name of ["lijecnik2", "skola", "admin"]) {
    const user = await login(name);
    response = await request(user.token, JSON.stringify({ attachment_id: id }));
    assert.equal(response.status, 403);
  }
  const doctor = await login("lijecnik");
  response = await request(doctor.token, JSON.stringify({ attachment_id: id }));
  assert.equal(response.status, 200);
  assert.ok(
    (
      await doctor.db.storage
        .from("medical-documents")
        .download("uploads/" + id)
    ).error,
  );
  assert.equal(
    (
      await patient.db.rpc("archive_attachment", {
        attachment_id: id,
        reason: "Završena integracijska provjera.",
      })
    ).error,
    null,
  );
  console.log(
    "PASS live file upload, idempotency, MIME and extension validation, SHA-256 roundtrip, private Storage, role isolation and archive.",
  );
} finally {
  await Promise.all(clients.map((client) => client.auth.signOut()));
}
