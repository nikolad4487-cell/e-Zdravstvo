import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
);
for (const file of (await readdir("supabase/migrations"))
  .filter((f) => f.endsWith(".sql"))
  .sort())
  await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
const uid = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const org = uid(10),
  doc = uid(20),
  otherDoc = uid(21);
for (let n = 1; n <= 6; n++)
  await db.exec(`insert into auth.users(id) values('${uid(n)}');`);
await db.exec(
  `insert into institutions(id,name,code) values('${org}','Testna ustanova','TEST');insert into institution_users(institution_id,user_id) values('${org}','${uid(1)}'),('${org}','${uid(2)}'),('${org}','${uid(3)}');insert into user_roles(user_id,role,institution_id) values('${uid(1)}','DOCTOR','${org}'),('${uid(2)}','DOCTOR','${org}'),('${uid(3)}','NURSE','${org}'),('${uid(4)}','PATIENT',null),('${uid(5)}','SCHOOL_ADMIN',null),('${uid(6)}','SYSTEM_ADMIN',null);insert into doctors(id,user_id,institution_id,display_name) values('${doc}','${uid(1)}','${org}','dr. Test'),('${otherDoc}','${uid(2)}','${org}','dr. Drugi');`,
);
async function as(n, fn) {
  await db.exec(
    `set role ${n === 0 ? "anon" : "authenticated"};set request.jwt.claim.sub='${n === 0 ? "" : uid(n)}'`,
  );
  try {
    return await fn();
  } finally {
    await db.exec("reset role;reset request.jwt.claim.sub");
  }
}
async function rpc(name, args = []) {
  return (
    await db.query(
      `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
      args,
    )
  ).rows[0].result;
}
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
const pid = await as(1, () =>
  rpc("create_patient", [
    {
      first_name: "Tin",
      last_name: "Testni",
      birth_date: "2010-03-14",
      sex: "M",
    },
    doc,
  ]),
);
await db.exec(
  `update patients set user_id='${uid(4)}' where id='${pid}';insert into patient_staff(patient_id,user_id,institution_id) values('${pid}','${uid(3)}','${org}')`,
);
await test("doctor creates patient and internal identifier", () =>
  as(1, async () =>
    assert.match(
      (await rpc("get_patient_chart", [pid])).patient.patient_number,
      /EZ-PAC-\d+/,
    ),
  ));
await test("doctor search supports name and birth date", () =>
  as(1, async () => {
    assert.equal((await rpc("search_patients", ["Tin"])).length, 1);
    assert.equal((await rpc("search_patients", ["14.03.2010"])).length, 1);
  }));
await test("unrelated doctor cannot open chart", () =>
  as(2, () => assert.rejects(rpc("get_patient_chart", [pid]))));
await test("school cannot open chart", () =>
  as(5, () => assert.rejects(rpc("get_patient_chart", [pid]))));
await test("central admin has no clinical bypass", () =>
  as(6, () => assert.rejects(rpc("get_patient_chart", [pid]))));
await test("patient can read own chart but cannot write", () =>
  as(4, async () => {
    assert.equal((await rpc("get_patient_chart", [pid])).can_write, false);
    await assert.rejects(rpc("update_patient_record", [pid, "A+", "no"]));
  }));
await test("nurse has explicitly assigned read-only access", () =>
  as(3, async () => {
    assert.equal((await rpc("get_patient_chart", [pid])).can_write, false);
    await assert.rejects(rpc("create_patient", [{ first_name: "x" }, doc]));
  }));
await test("direct table reads cannot bypass audit", () =>
  as(1, () => assert.rejects(db.exec("select * from patients"))));
await test("patient creation cannot impersonate another doctor", () =>
  as(1, () => assert.rejects(rpc("create_patient", [{}, otherDoc]))));
await test("anonymous clinical access denied", () =>
  as(0, () => assert.rejects(rpc("get_patient_chart", [pid]))));
await test("chart reads are server audited", async () =>
  assert.ok(
    (
      await db.query(
        "select count(*)::int n from audit_logs where action='PATIENT_RECORD_VIEWED'",
      )
    ).rows[0].n >= 3,
  ));
await test("clinical records cannot be hard deleted", () =>
  assert.rejects(db.exec(`delete from patients where id='${pid}'`)));
await test("revocation immediately removes care access", async () => {
  await db.exec(
    `update patient_doctors set revoked_at=now() where patient_id='${pid}' and doctor_id='${doc}'`,
  );
  await as(1, () => assert.rejects(rpc("get_patient_chart", [pid])));
  await db.exec(
    `update patient_doctors set revoked_at=null where patient_id='${pid}' and doctor_id='${doc}'`,
  );
});
console.log(`${passed} clinical access checks passed.`);
await db.exec(
  `insert into diagnoses(id,code,name) values('${uid(30)}','DEMO-01','Testna dijagnoza');insert into medications(id,name,active_ingredient,strength,form,packaging,route) values('${uid(31)}','Testni pripravak','Test','Demo','Tableta','Demo','Demo');`,
);
const encounterData = {
  encountered_at: new Date().toISOString(),
  kind: "Testni pregled",
  reason: "Test",
  systolic: 120,
  diastolic: 80,
  height_cm: 180,
  weight_kg: 81,
  diagnoses: [{ id: uid(30), is_primary: true }],
};
const encounter = await as(1, () =>
  rpc("create_encounter", [pid, encounterData, null]),
);
await test("encounter calculates BMI and includes diagnosis", () =>
  as(1, async () => {
    const e = (await rpc("get_patient_chart", [pid])).encounters[0];
    assert.equal(e.bmi, 25);
    assert.equal(e.diagnoses[0].code, "DEMO-01");
  }));
await test("nurse cannot author encounter", () =>
  as(3, () =>
    assert.rejects(rpc("create_encounter", [pid, encounterData, null])),
  ));
await test("invalid vitals rollback entire encounter", () =>
  as(1, () =>
    assert.rejects(
      rpc("create_encounter", [pid, { ...encounterData, spo2: 200 }, null]),
    ),
  ));
await test("amendment preserves original and links versions", () =>
  as(1, async () => {
    const next = await rpc("create_encounter", [
      pid,
      {
        ...encounterData,
        reason: "Ispravak",
        amendment_reason: "Ispravak pogrešnog unosa",
      },
      encounter,
    ]);
    const chart = await rpc("get_patient_chart", [pid]);
    assert.equal(
      chart.encounters.find((e) => e.id === encounter).reason,
      "Test",
    );
    assert.equal(
      chart.encounters.find((e) => e.id === encounter).superseded_by,
      next,
    );
    await assert.rejects(
      rpc("create_encounter", [
        pid,
        { ...encounterData, amendment_reason: "ponovno" },
        encounter,
      ]),
    );
  }));
await test("published encounter content cannot be overwritten", () =>
  assert.rejects(
    db.exec(
      `update medical_encounters set reason='overwrite' where id='${encounter}'`,
    ),
  ));
await test("diagnosis and therapy writes require treating doctor", async () => {
  await as(1, () =>
    rpc("add_patient_diagnosis", [
      pid,
      { diagnosis_id: uid(30), diagnosed_at: "2026-01-01", status: "CHRONIC" },
    ]),
  );
  await as(1, () =>
    rpc("add_patient_therapy", [
      pid,
      {
        medication_id: uid(31),
        dosage: "Test",
        frequency: "Test",
        start_date: "2026-01-01",
      },
    ]),
  );
  await as(2, () =>
    assert.rejects(
      rpc("add_patient_therapy", [
        pid,
        {
          medication_id: uid(31),
          dosage: "Test",
          frequency: "Test",
          start_date: "2026-01-01",
        },
      ]),
    ),
  );
});
const expiry = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const rx = {
  expires_on: expiry,
  items: [
    {
      medication_id: uid(31),
      dosage: "Testno doziranje",
      quantity: 1,
      route: "Testni način",
      duration: "Testno trajanje",
      notes: "Isključivo test",
    },
  ],
};
const rxId = await as(1, () =>
  rpc("issue_document", [pid, "PRESCRIPTION", rx, uid(50)]),
);
const excuseId = await as(1, () =>
  rpc("issue_document", [
    pid,
    "SCHOOL_EXCUSE",
    {
      expires_on: expiry,
      date_from: "2026-01-10",
      date_to: "2026-01-12",
      category: "Privatni testni razlog",
      school: "Testna škola",
      notes: "Privatna napomena",
    },
    uid(51),
  ]),
);
await test("document numbering and server signature generated", () =>
  as(1, async () => {
    const d = await rpc("get_document", [rxId, "VIEW"]);
    assert.match(d.number, /^EZ-REC-\d{4}-\d{8}$/);
    assert.equal(d.signature.integrity_valid, true);
    assert.match(d.signature.signature_hash, /^[a-f0-9]{64}$/);
  }));
await test("idempotent issue does not duplicate documents", () =>
  as(1, async () =>
    assert.equal(
      await rpc("issue_document", [pid, "PRESCRIPTION", rx, uid(50)]),
      rxId,
    ),
  ));
await test("patient can view own issued documents", () =>
  as(4, async () =>
    assert.equal((await rpc("list_documents", [pid, null])).length, 2),
  ));
await test("nurse cannot issue a prescription", () =>
  as(3, () =>
    assert.rejects(rpc("issue_document", [pid, "PRESCRIPTION", rx, uid(52)])),
  ));
await test("unrelated doctor cannot issue document", () =>
  as(2, () =>
    assert.rejects(rpc("issue_document", [pid, "PRESCRIPTION", rx, uid(52)])),
  ));
await test("invalid prescription rolls back signature and document", () =>
  as(1, async () => {
    await assert.rejects(
      rpc("issue_document", [
        pid,
        "PRESCRIPTION",
        { ...rx, items: [{ ...rx.items[0], quantity: 0 }] },
        uid(53),
      ]),
    );
    assert.equal((await rpc("list_documents", [pid, null])).length, 2);
  }));
await test("revocation requires a non-null reason", () =>
  as(1, () => assert.rejects(rpc("revoke_document", [excuseId, null]))));
const excuse = await as(1, () => rpc("get_document", [excuseId, "VIEW"]));
await test("public verification returns minimal metadata only", () =>
  as(0, async () => {
    const v = await rpc("verify_document", [excuse.verification_token]);
    assert.equal(v.status, "VALID");
    assert.deepEqual(
      Object.keys(v).sort(),
      [
        "expires_on",
        "institution",
        "issued_at",
        "issuer",
        "kind",
        "number",
        "signature_method",
        "status",
      ].sort(),
    );
    assert.ok(!JSON.stringify(v).includes("Privatni"));
  }));
await test("document numbers cannot be enumerated anonymously", () =>
  as(0, async () =>
    assert.equal(await rpc("verify_document", [excuse.number]), null),
  ));
await test("school can check excuse number but not read document", () =>
  as(5, async () => {
    assert.equal(
      (await rpc("verify_document", [excuse.number])).status,
      "VALID",
    );
    await assert.rejects(rpc("get_document", [excuseId, "VIEW"]));
  }));
await test("patient cannot revoke issued document", () =>
  as(4, () =>
    assert.rejects(rpc("revoke_document", [excuseId, "Test opoziva"])),
  ));
await test("issued document payload cannot be modified", () =>
  assert.rejects(
    db.exec(`update documents set payload='{}' where id='${rxId}'`),
  ));
await test("revocation immediately changes public verification", async () => {
  await as(1, () =>
    rpc("revoke_document", [excuseId, "Ispravak testne ispričnice"]),
  );
  await as(0, async () =>
    assert.equal(
      (await rpc("verify_document", [excuse.verification_token])).status,
      "REVOKED",
    ),
  );
});
await test("notification delivery is limited to patient", async () => {
  await as(4, async () =>
    assert.equal(
      (await db.query("select count(*)::int n from notifications")).rows[0].n,
      3,
    ),
  );
  await as(5, async () =>
    assert.equal(
      (await db.query("select count(*)::int n from notifications")).rows[0].n,
      0,
    ),
  );
});
console.log(`${passed} total clinical checks passed.`);
await test("personal portal requires patient role and returns own chart", async () => {
  await as(4, async () =>
    assert.equal((await rpc("get_my_chart")).patient.id, pid),
  );
  await as(1, () => assert.rejects(rpc("get_my_chart")));
  await as(5, () => assert.rejects(rpc("get_my_chart")));
});
await test("personal portal remains personal for multi-role users", async () => {
  await db.exec(
    `insert into institution_users(institution_id,user_id) values('${org}','${uid(4)}');insert into user_roles(user_id,role,institution_id) values('${uid(4)}','DOCTOR','${org}');`,
  );
  await as(4, async () =>
    assert.equal((await rpc("get_my_chart")).patient.id, pid),
  );
});
await test("download and verification events are audited", async () => {
  await as(4, () => rpc("get_document", [rxId, "DOWNLOAD"]));
  const actions = (
    await db.query(
      "select distinct action from audit_logs where action in ('DOCUMENT_DOWNLOADED','DOCUMENT_VERIFIED','PRESCRIPTION_ISSUED')",
    )
  ).rows;
  assert.equal(actions.length, 3);
});
console.log(`${passed} final clinical checks passed.`);
const uploadData = {
  title: "Testni privitak",
  category: "REPORT",
  file_name: "test.pdf",
  content_type: "application/pdf",
  byte_size: 8,
  sha256: "a".repeat(64),
};
const attachment = await as(4, () =>
  rpc("reserve_attachment", [pid, uploadData, uid(70)]),
);
await test("patient can reserve an upload only for own chart", async () => {
  const otherPatient = await as(1, () =>
    rpc("create_patient", [
      {
        first_name: "Drugi",
        last_name: "Test",
        birth_date: "2000-01-01",
        sex: "M",
      },
      doc,
    ]),
  );
  await as(4, () =>
    assert.rejects(
      rpc("reserve_attachment", [otherPatient, uploadData, uid(71)]),
    ),
  );
});
await test("nurse, school and unrelated doctor cannot upload", async () => {
  for (const n of [2, 3, 5, 6])
    await as(n, () =>
      assert.rejects(rpc("reserve_attachment", [pid, uploadData, uid(71)])),
    );
});
await test("upload retry is idempotent and cannot replace content", () =>
  as(4, async () => {
    assert.equal(
      await rpc("reserve_attachment", [pid, uploadData, uid(70)]),
      attachment,
    );
    await assert.rejects(
      rpc("reserve_attachment", [
        pid,
        { ...uploadData, sha256: "b".repeat(64) },
        uid(70),
      ]),
    );
  }));
await test("missing storage object cannot be finalized or downloaded", () =>
  as(4, async () => {
    await assert.rejects(rpc("finish_attachment", [attachment]));
    await assert.rejects(rpc("attachment_transfer", [attachment, "DOWNLOAD"]));
    assert.equal((await rpc("list_attachments", [pid, false])).length, 0);
  }));
await db.query(
  "insert into storage.objects(bucket_id,name,metadata) values('medical-documents',$1,$2)",
  ["uploads/" + attachment, { size: 8, mimetype: "application/pdf" }],
);
await as(4, () => rpc("finish_attachment", [attachment]));
await test("authorized team sees upload metadata without storage path", () =>
  as(1, async () => {
    const list = await rpc("list_attachments", [pid, false]);
    assert.equal(list.length, 1);
    assert.ok(!("storage_path" in list[0]));
    assert.equal(list[0].can_archive, false);
  }));
await test("direct storage and attachment reads cannot bypass audited transfer", () =>
  as(4, async () => {
    await assert.rejects(db.exec("select * from storage.objects"));
    await assert.rejects(db.exec("select * from document_attachments"));
    assert.equal(
      (await rpc("attachment_transfer", [attachment, "DOWNLOAD"])).id,
      attachment,
    );
  }));
await test("unauthorized users cannot obtain download transfer", async () => {
  for (const n of [0, 2, 5, 6])
    await as(n, () =>
      assert.rejects(rpc("attachment_transfer", [attachment, "DOWNLOAD"])),
    );
});
await test("upload content is immutable and cannot be deleted", async () => {
  await assert.rejects(
    db.query("update document_attachments set title=$1 where id=$2", [
      "overwrite",
      attachment,
    ]),
  );
  await assert.rejects(
    db.query("delete from document_attachments where id=$1", [attachment]),
  );
});
await test("only uploader may archive, with reason and original retained", async () => {
  await as(1, () =>
    assert.rejects(rpc("archive_attachment", [attachment, "Test arhive"])),
  );
  await as(4, async () => {
    await assert.rejects(rpc("archive_attachment", [attachment, null]));
    await rpc("archive_attachment", [attachment, "Pogrešan testni privitak"]);
    assert.equal((await rpc("list_attachments", [pid, false])).length, 0);
    assert.equal(
      (await rpc("list_attachments", [pid, true]))[0].status,
      "ARCHIVED",
    );
    assert.equal(
      (await rpc("attachment_transfer", [attachment, "DOWNLOAD"])).sha256,
      uploadData.sha256,
    );
  });
});
await test("patient dashboard is personal and excludes archived uploads", async () => {
  await as(4, async () => {
    const d = await rpc("patient_dashboard");
    assert.equal(d.patient_id, pid);
    assert.equal(d.attachments, 0);
    assert.ok(d.unread_notifications > 0);
  });
  await as(5, () => assert.rejects(rpc("patient_dashboard")));
});
const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
await as(1, () =>
  rpc("issue_document", [
    pid,
    "PRESCRIPTION",
    { ...rx, expires_on: soon },
    uid(72),
  ]),
);
await test("expiry reminders are generated once per document", async () => {
  const first = await db.query("select private.notify_expiring_documents() n");
  assert.equal(first.rows[0].n, 1);
  assert.equal(
    (await db.query("select private.notify_expiring_documents() n")).rows[0].n,
    0,
  );
});
await test("only patient can mark own notifications read", async () => {
  await as(5, () => assert.rejects(rpc("mark_notification_read", [null])));
  await as(4, async () => {
    await rpc("mark_notification_read", [null]);
    assert.equal((await rpc("patient_dashboard")).unread_notifications, 0);
  });
});

await test("administration denies patients, school and unrelated clinicians", async () => {
  for (const n of [1, 3, 4, 5])
    await as(n, () => assert.rejects(rpc("admin_configuration")));
  await as(5, () => assert.rejects(rpc("admin_users", ["", 0])));
});
let clinic, template;
await test("central returns aggregates and manages clinic identity", () =>
  as(6, async () => {
    const overview = await rpc("central_overview");
    assert.equal(overview.patients, 2);
    assert.ok(!("medical_records" in overview));
    assert.equal((await rpc("admin_users", ["", 0])).length, 6);
    clinic = await rpc("save_clinic", [
      org,
      null,
      { name: "Testna ambulanta", code: "TEST-A", address: "Testna 1" },
    ]);
    await rpc("save_doctor_identity", [
      doc,
      { display_name: "dr. Test", doctor_code: "TEST-L", clinic_id: clinic },
    ]);
    const c = await rpc("admin_configuration");
    assert.notEqual(
      c.doctors[0].signer_fingerprint,
      c.doctors[1].signer_fingerprint,
    );
    template = c.templates[0];
  }));
await test("template versions immutable and stale edits rejected", () =>
  as(6, async () => {
    await rpc("save_excuse_template", [org, template.excuse_type, 0, template]);
    await assert.rejects(
      rpc("save_excuse_template", [org, template.excuse_type, 0, template]),
    );
    assert.equal(
      (await rpc("admin_configuration")).templates.find(
        (t) => t.excuse_type === template.excuse_type,
      ).version,
      1,
    );
  }));
await test("signer key protected and HMAC matches RFC 4231", async () => {
  const h = await db.query(
    "select encode(private.hmac_sha256(convert_to('Hi There','UTF8'),decode(repeat('0b',20),'hex')),'hex') h",
  );
  assert.equal(
    h.rows[0].h,
    "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
  );
  await as(6, () =>
    assert.rejects(db.query("select * from private.doctor_signing_keys")),
  );
  await as(6, () => assert.rejects(db.query("select * from clinics")));
});
await db.exec(
  `insert into user_roles(user_id,role,institution_id) values('${uid(1)}','INSTITUTION_ADMIN','${org}');insert into institutions(id,name,code) values('${uid(11)}','Druga ustanova','TEST2')`,
);
await test("institution administrator is scoped and cannot edit global catalogs", () =>
  as(1, async () => {
    assert.equal((await rpc("admin_configuration")).institutions.length, 1);
    await assert.rejects(
      rpc("save_clinic", [uid(11), null, { name: "Forbidden", code: "NO" }]),
    );
    await assert.rejects(
      rpc("save_excuse_catalog", [
        "reason",
        null,
        { name: "Forbidden", code: "NO" },
      ]),
    );
    await assert.rejects(
      rpc("admin_grant_role", [uid(1), "SYSTEM_ADMIN", null]),
    );
  }));
console.log(`${passed} total clinical and document checks passed.`);
await db.close();
