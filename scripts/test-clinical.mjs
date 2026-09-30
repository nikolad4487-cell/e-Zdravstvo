import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(
  `create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,encrypted_password text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,anon;create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`,
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

const excuseContext = await as(1, () => rpc("excuse_context", [pid]));
const schoolData = {
  expires_on: expiry,
  date_from: "2026-09-25",
  date_to: "2026-09-28",
  excuse_type: "REGULAR",
  clinic_id: clinic,
  reason_id: excuseContext.reasons[0].id,
  diagnosis_id: uid(30),
  print_diagnosis: false,
};
let regular, pe;
await test("new excuses snapshot template, clinic and personal HMAC signature", () =>
  as(1, async () => {
    const id = await rpc("issue_document", [
      pid,
      "SCHOOL_EXCUSE",
      schoolData,
      uid(80),
    ]);
    regular = await rpc("get_document", [id, "VIEW"]);
    assert.equal(regular.payload.details.clinic.code, "TEST-A");
    assert.equal(regular.payload.details.doctor_code, "TEST-L");
    assert.equal(regular.signature.signature_method, "HMAC_SHA256_INTERNAL");
    assert.equal(regular.signature.integrity_valid, true);
    assert.equal(regular.payload.details.diagnosis_code, null);
    const peId = await rpc("issue_document", [
      pid,
      "SCHOOL_EXCUSE",
      { ...schoolData, excuse_type: "PE", print_diagnosis: true },
      uid(81),
    ]);
    pe = await rpc("get_document", [peId, "VIEW"]);
    assert.ok(pe.payload.details.diagnosis_code);
    assert.equal(pe.payload.details.template.excuse_type, "PE");
    assert.notEqual(
      pe.signature.signature_hash,
      regular.signature.signature_hash,
    );
  }));
await test("excuse validation rejects unapproved clinic, type and printed code", () =>
  as(1, async () => {
    for (const change of [
      { clinic_id: uid(999) },
      { excuse_type: "INVALID" },
      { reason_id: uid(999) },
      { print_diagnosis: true, diagnosis_id: "" },
    ])
      await assert.rejects(
        rpc("issue_document", [
          pid,
          "SCHOOL_EXCUSE",
          { ...schoolData, ...change },
          uid(82),
        ]),
      );
  }));
await test("public verification excludes student, diagnosis, absence dates and contact data", () =>
  as(0, async () => {
    const v = await rpc("verify_document", [pe.verification_token]);
    assert.equal(v.status, "VALID");
    assert.equal(v.signature_method, "HMAC_SHA256_INTERNAL");
    for (const secret of [
      "patient",
      "diagnosis_code",
      "date_from",
      "clinic",
      "phone",
      "template",
    ])
      assert.ok(!(secret in v));
  }));
await test("template and doctor edits leave issued document and signature unchanged", async () => {
  await as(6, async () => {
    const t = (await rpc("admin_configuration")).templates.find(
      (t) => t.excuse_type === "REGULAR",
    );
    await rpc("save_excuse_template", [
      org,
      "REGULAR",
      t.version,
      { ...t, title: "Novi naslov" },
    ]);
    await rpc("save_doctor_identity", [
      doc,
      {
        display_name: "dr. Izmijenjeni",
        doctor_code: "NOVO",
        clinic_id: clinic,
      },
    ]);
  });
  const original = await as(4, () => rpc("get_document", [regular.id, "VIEW"]));
  assert.deepEqual(original.payload, regular.payload);
  assert.equal(
    original.signature.signature_hash,
    regular.signature.signature_hash,
  );
  assert.equal(original.signature.integrity_valid, true);
  const fresh = await as(1, () =>
    rpc("issue_document", [pid, "SCHOOL_EXCUSE", schoolData, uid(83)]),
  );
  const d = await as(1, () => rpc("get_document", [fresh, "VIEW"]));
  assert.equal(d.payload.details.template.title, "Novi naslov");
  assert.equal(d.payload.details.doctor_code, "NOVO");
  assert.equal(
    d.payload.details.signer_fingerprint,
    regular.payload.details.signer_fingerprint,
  );
});
await test("tampered MAC is rejected and legacy SHA signatures remain verifiable", async () => {
  await db.query(
    "update digital_signatures set signature_hash=repeat('0',64) where document_id=$1",
    [pe.id],
  );
  assert.equal(
    (await as(0, () => rpc("verify_document", [pe.verification_token]))).status,
    "INVALID",
  );
  await db.query(
    "update digital_signatures s set signature_hash=encode(sha256(convert_to(d.payload::text,'UTF8')),'hex'),signature_method='DEMO_SHA256' from documents d where s.document_id=d.id and d.id=$1",
    [rxId],
  );
  assert.equal(
    (await as(1, () => rpc("get_document", [rxId, "VIEW"]))).signature
      .integrity_valid,
    true,
  );
});

const scheduleDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Zagreb",
}).format(new Date());
const apData = {
  patient_id: pid,
  doctor_id: doc,
  local_time: scheduleDate + "T15:00",
  duration_minutes: 20,
  kind: "Testni pregled",
};
let appointment;
await test("doctor schedules and repeated request does not duplicate", () =>
  as(1, async () => {
    appointment = await rpc("save_appointment", [null, null, apData, uid(90)]);
    assert.equal(
      await rpc("save_appointment", [null, null, apData, uid(90)]),
      appointment,
    );
    const all = await rpc("list_appointments", [
      scheduleDate,
      scheduleDate,
      false,
      null,
    ]);
    assert.equal(all.length, 1);
    assert.equal(all[0].status, "SCHEDULED");
  }));
await test("overlap denied but adjacent slot accepted", () =>
  as(1, async () => {
    await assert.rejects(
      rpc("save_appointment", [
        null,
        null,
        { ...apData, local_time: scheduleDate + "T15:10" },
        uid(91),
      ]),
    );
    await rpc("save_appointment", [
      null,
      null,
      { ...apData, local_time: scheduleDate + "T15:20" },
      uid(92),
    ]);
  }));
await test("schedule is hidden from school, administrator and unrelated doctor", async () => {
  for (const n of [2, 5, 6])
    await as(n, async () => {
      assert.equal(
        (
          await rpc("list_appointments", [
            scheduleDate,
            scheduleDate,
            false,
            null,
          ])
        ).length,
        0,
      );
      await assert.rejects(
        rpc("save_appointment", [null, null, apData, uid(93)]),
      );
    });
  await as(0, () =>
    assert.rejects(
      rpc("list_appointments", [scheduleDate, scheduleDate, false, null]),
    ),
  );
  await as(4, async () => {
    assert.equal(
      (await rpc("list_appointments", [scheduleDate, scheduleDate, true, null]))
        .length,
      2,
    );
    await assert.rejects(
      rpc("set_appointment_status", [appointment, 1, "ARRIVED", ""]),
    );
  });
});
await test("nurse records arrival but cannot start examination", () =>
  as(3, async () => {
    await rpc("set_appointment_status", [appointment, 1, "ARRIVED", ""]);
    await assert.rejects(
      rpc("set_appointment_status", [appointment, 2, "IN_PROGRESS", ""]),
    );
  }));
await test("stale versions rejected and clinical status transitions ordered", () =>
  as(1, async () => {
    await assert.rejects(
      rpc("set_appointment_status", [appointment, 1, "IN_PROGRESS", ""]),
    );
    await assert.rejects(
      rpc("set_appointment_status", [appointment, 2, "COMPLETED", ""]),
    );
    await rpc("set_appointment_status", [appointment, 2, "IN_PROGRESS", ""]);
    await rpc("set_appointment_status", [appointment, 3, "COMPLETED", ""]);
    await assert.rejects(
      rpc("set_appointment_status", [appointment, 4, "SCHEDULED", ""]),
    );
  }));
await test("appointment history is retained and direct reads/deletes denied", async () => {
  assert.equal(
    (
      await db.query(
        "select count(*) n from appointment_history where appointment_id=$1",
        [appointment],
      )
    ).rows[0].n,
    3,
  );
  await as(6, () => assert.rejects(db.query("select * from appointments")));
  await assert.rejects(
    db.query("delete from appointments where id=$1", [appointment]),
  );
  assert.ok(
    (await db.query("select count(*) n from schedule_events")).rows[0].n >= 2,
  );
});

await db.exec(
  `insert into auth.users(id) values('${uid(7)}'),('${uid(8)}');insert into institution_users(institution_id,user_id) values('${org}','${uid(7)}'),('${uid(11)}','${uid(8)}');insert into user_roles(user_id,role,institution_id) values('${uid(7)}','LAB_TECHNICIAN','${org}'),('${uid(8)}','LAB_TECHNICIAN','${uid(11)}');`,
);
let labOrder, labResult;
await test("only treating physician can order laboratory work", async () => {
  const data = {
    laboratory_institution_id: org,
    requested_tests: "Testni panel",
    clinical_question: "Testno pitanje",
    priority: "REGULAR",
  };
  for (const n of [2, 3, 4, 5, 6, 7])
    await as(n, () =>
      assert.rejects(rpc("order_laboratory", [pid, data, uid(100)])),
    );
  labOrder = await as(1, () => rpc("order_laboratory", [pid, data, uid(100)]));
  assert.equal(
    await as(1, () => rpc("order_laboratory", [pid, data, uid(100)])),
    labOrder,
  );
});
await test("laboratory access restricted to assigned institution without chart access", async () => {
  await as(7, async () => {
    assert.equal((await rpc("list_laboratory", ["LAB", null, 0])).length, 1);
    await assert.rejects(rpc("get_patient_chart", [pid]));
  });
  for (const n of [2, 5, 6, 8])
    await as(n, async () =>
      assert.equal((await rpc("list_laboratory", ["LAB", null, 0])).length, 0),
    );
  await as(4, async () =>
    assert.equal(
      (await rpc("list_laboratory", ["PERSONAL", null, 0])).length,
      1,
    ),
  );
});
const resultData = {
  sampled_at: new Date().toISOString(),
  summary: "Testni zaključak",
  parameters: [
    {
      code: "LOW",
      name: "Test A",
      value: 2,
      unit: "test",
      reference_low: 3,
      reference_high: 5,
    },
    {
      code: "NORMAL",
      name: "Test B",
      value: 4,
      unit: "test",
      reference_low: 3,
      reference_high: 5,
    },
    {
      code: "HIGH",
      name: "Test C",
      value: 6,
      unit: "test",
      reference_low: 3,
      reference_high: 5,
    },
    {
      code: "CRITICAL",
      name: "Test D",
      value: 99,
      unit: "test",
      critical: true,
    },
    { code: "NONE", name: "Test E", value: 4, unit: "test" },
  ],
};
await test("lab result publication requires processing, complete parameters and appropriate role", async () => {
  await as(7, () =>
    assert.rejects(
      rpc("publish_laboratory_result", [labOrder, null, resultData]),
    ),
  );
  await as(7, () =>
    rpc("set_lab_order_status", [labOrder, 1, "IN_PROGRESS", ""]),
  );
  await as(1, () =>
    assert.rejects(
      rpc("publish_laboratory_result", [labOrder, null, resultData]),
    ),
  );
  await as(7, () =>
    assert.rejects(
      rpc("publish_laboratory_result", [
        labOrder,
        null,
        {
          ...resultData,
          parameters: [
            {
              code: "BAD",
              name: "Test",
              value: 4,
              reference_low: 8,
              reference_high: 2,
            },
          ],
        },
      ]),
    ),
  );
  labResult = await as(7, () =>
    rpc("publish_laboratory_result", [labOrder, null, resultData]),
  );
});
await test("patient sees flags calculated against laboratory reference intervals", () =>
  as(4, async () => {
    const o = (await rpc("list_laboratory", ["PERSONAL", null, 0]))[0];
    assert.equal(o.status, "COMPLETED");
    const flags = Object.fromEntries(
      o.results[0].parameters.map((p) => [p.code, p.flag]),
    );
    assert.deepEqual(flags, {
      LOW: "LOW",
      NORMAL: "NORMAL",
      HIGH: "HIGH",
      CRITICAL: "CRITICAL",
      NONE: null,
    });
    assert.equal(o.can_publish, false);
  }));
await test("corrections preserve immutable original and reject stale changes", async () => {
  await assert.rejects(
    db.query("update laboratory_results set summary=$1 where id=$2", [
      "overwrite",
      labResult,
    ]),
  );
  await as(7, () =>
    assert.rejects(
      rpc("publish_laboratory_result", [labOrder, labResult, resultData]),
    ),
  );
  const second = await as(7, () =>
    rpc("publish_laboratory_result", [
      labOrder,
      labResult,
      { ...resultData, correction_reason: "Ispravak testnog rezultata" },
    ]),
  );
  const results = (
    await as(4, () => rpc("list_laboratory", ["PERSONAL", null, 0]))
  )[0].results;
  assert.equal(results.length, 2);
  assert.equal(results[1].superseded_by, second);
  await as(7, () =>
    assert.rejects(
      rpc("publish_laboratory_result", [
        labOrder,
        labResult,
        { ...resultData, correction_reason: "Stari rezultat" },
      ]),
    ),
  );
  await as(6, () =>
    assert.rejects(db.query("select * from laboratory_results")),
  );
});

await test("care administration exposes metadata without chart contents", async () => {
  const list = await as(6, () => rpc("admin_patients", ["Tin", 0]));
  assert.ok(list.length > 0);
  assert.ok(!("birth_date" in list[0]));
  assert.ok(!("diagnoses" in list[0]));
  for (const n of [2, 3, 4, 5, 7])
    await as(n, () => assert.rejects(rpc("admin_patients", ["", 0])));
});
await test("administrator grants and revokes explicit care without gaining clinical access", async () => {
  await as(6, () =>
    rpc("set_patient_care", [
      pid,
      "DOCTOR",
      otherDoc,
      true,
      false,
      "Testna dodjela skrbnom timu",
    ]),
  );
  await as(2, async () =>
    assert.equal((await rpc("get_patient_chart", [pid])).patient.id, pid),
  );
  await as(6, () => assert.rejects(rpc("get_patient_chart", [pid])));
  await as(6, () =>
    rpc("set_patient_care", [
      pid,
      "DOCTOR",
      otherDoc,
      false,
      false,
      "Testni opoziv skrbne veze",
    ]),
  );
  await as(2, () => assert.rejects(rpc("get_patient_chart", [pid])));
});
await test("scoped admin can manage own care teams but cannot link patient accounts", () =>
  as(1, async () => {
    const team = await rpc("admin_care_team", [pid]);
    assert.equal(team.doctors.length, 2);
    await assert.rejects(
      rpc("link_patient_account", [pid, uid(4), "Zabranjeno povezivanje"]),
    );
    await assert.rejects(
      rpc("set_patient_care", [pid, "DOCTOR", otherDoc, true, false, ""]),
    );
  }));
await test("account linking cannot overwrite existing ownership or accept nonpatients", async () => {
  await as(6, () =>
    assert.rejects(
      rpc("link_patient_account", [pid, uid(7), "Pogrešan korisnički račun"]),
    ),
  );
  await as(6, () =>
    assert.rejects(
      rpc("link_patient_account", [pid, uid(4), "Već povezan karton"]),
    ),
  );
});

let provisioning;
await test("only system administrator can request user provisioning", async () => {
  for (const n of [1, 3, 4, 5, 7])
    await as(n, () =>
      assert.rejects(
        rpc("begin_account_provision", [
          uid(110),
          "new@demo.e-zdravstvo.test",
          "Novi",
          "Testni",
          true,
        ]),
      ),
    );
  provisioning = await as(6, () =>
    rpc("begin_account_provision", [
      uid(110),
      "new@demo.e-zdravstvo.test",
      "Novi",
      "Testni",
      true,
    ]),
  );
  assert.equal(
    (
      await as(6, () =>
        rpc("begin_account_provision", [
          uid(110),
          "new@demo.e-zdravstvo.test",
          "Novi",
          "Testni",
          true,
        ]),
      )
    ).id,
    provisioning.id,
  );
  await as(6, () =>
    assert.rejects(
      rpc("begin_account_provision", [
        uid(110),
        "other@demo.e-zdravstvo.test",
        "Novi",
        "Testni",
        true,
      ]),
    ),
  );
});
await db.query(
  "insert into auth.users(id,email,encrypted_password,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$4,$5)",
  [
    uid(9),
    "new@demo.e-zdravstvo.test",
    "initial-hash",
    { first_name: "Novi", last_name: "Testni", must_change_password: false },
    {
      admin_provisioned: true,
      is_demo: true,
      provision_request_id: provisioning.id,
      provision_actor_id: uid(6),
    },
  ],
);
await test("provisioning recovery validates server metadata and writes actor audit", async () => {
  assert.equal(
    (
      await as(6, () =>
        rpc("begin_account_provision", [
          uid(110),
          "new@demo.e-zdravstvo.test",
          "Novi",
          "Testni",
          true,
        ]),
      )
    ).user_id,
    uid(9),
  );
  await as(6, () =>
    assert.rejects(rpc("finish_account_provision", [provisioning.id, uid(4)])),
  );
  await as(6, () => rpc("finish_account_provision", [provisioning.id, uid(9)]));
  assert.equal(
    (
      await db.query(
        "select count(*) n from audit_logs where action='ACCOUNT_CREATED' and entity_id=$1",
        [uid(9)],
      )
    ).rows[0].n,
    1,
  );
});
await as(6, () => rpc("admin_grant_role", [uid(9), "SYSTEM_ADMIN", null]));
await test("initial password blocks privileged actions even when role is assigned", async () => {
  assert.equal(
    (
      await db.query("select must_change_password from profiles where id=$1", [
        uid(9),
      ])
    ).rows[0].must_change_password,
    true,
  );
  await as(9, () => assert.rejects(rpc("central_overview")));
  await as(9, () =>
    assert.rejects(
      db.query("update profiles set must_change_password=false where id=$1", [
        uid(9),
      ]),
    ),
  );
});
await test("only actual Auth password change releases initial access requirement", async () => {
  await db.query("update auth.users set raw_user_meta_data=$1 where id=$2", [
    { must_change_password: false },
    uid(9),
  ]);
  await as(9, () => assert.rejects(rpc("central_overview")));
  await db.query("update auth.users set encrypted_password=$1 where id=$2", [
    "changed-hash",
    uid(9),
  ]);
  assert.ok((await as(9, () => rpc("central_overview"))).users > 0);
  await as(9, () =>
    assert.rejects(
      db.query("select * from private.account_provision_requests"),
    ),
  );
});
await test("late trusted Auth metadata enables onboarding and cannot reset it later", async () => {
  await db.query(
    "insert into auth.users(id,email,encrypted_password) values($1,$2,$3)",
    [uid(111), "late@demo.e-zdravstvo.test", ""],
  );
  await db.query(
    "update auth.users set raw_app_meta_data=$1,encrypted_password=$2 where id=$3",
    [
      {
        admin_provisioned: true,
        is_demo: true,
        provision_request_id: uid(112),
      },
      "initial-hash",
      uid(111),
    ],
  );
  const read = async () =>
    (
      await db.query(
        "select must_change_password,is_demo from profiles where id=$1",
        [uid(111)],
      )
    ).rows[0];
  assert.deepEqual(await read(), { must_change_password: true, is_demo: true });
  await db.query("update auth.users set encrypted_password=$1 where id=$2", [
    "changed-hash",
    uid(111),
  ]);
  await db.query(
    "update auth.users set raw_app_meta_data=raw_app_meta_data||'{\"other\":true}'::jsonb where id=$1",
    [uid(111)],
  );
  assert.equal((await read()).must_change_password, false);
});
await test("hospital service and slots require scoped administration", async () => {
  await as(5, () => assert.rejects(rpc("hospital_context", [true])));
  await as(2, () =>
    assert.rejects(
      rpc("save_hospital_service", [
        null,
        {
          institution_id: org,
          doctor_id: otherDoc,
          name: "Testni pregled",
          specialty: "Testna specijalnost",
          location: "Ambulanta 1",
        },
      ]),
    ),
  );
});
const hospitalService = await as(6, () =>
  rpc("save_hospital_service", [
    null,
    {
      institution_id: org,
      doctor_id: otherDoc,
      name: "Testni pregled",
      specialty: "Testna specijalnost",
      location: "Ambulanta 1",
    },
  ]),
);
const hospitalDate = new Date(Date.now() + 5 * 86400000)
  .toISOString()
  .slice(0, 10);
await as(6, () =>
  rpc("publish_hospital_slots", [
    hospitalService,
    hospitalDate + "T10:00",
    30,
    2,
    true,
  ]),
);
const hospitalAvailable = await as(1, () =>
  rpc("list_hospital_slots", [
    hospitalService,
    hospitalDate,
    hospitalDate,
    false,
  ]),
);
let hb;
await test("hospital booking requires care link, priority reason and available slot", async () => {
  await as(2, () =>
    assert.rejects(
      rpc("book_hospital_slot", [
        pid,
        hospitalAvailable[0].id,
        null,
        true,
        "Prioritet test",
        uid(121),
      ]),
    ),
  );
  await as(1, () =>
    assert.rejects(
      rpc("book_hospital_slot", [
        pid,
        hospitalAvailable[0].id,
        null,
        false,
        "",
        uid(121),
      ]),
    ),
  );
  await as(1, () =>
    assert.rejects(
      rpc("book_hospital_slot", [
        pid,
        hospitalAvailable[0].id,
        null,
        true,
        "",
        uid(121),
      ]),
    ),
  );
  hb = await as(1, () =>
    rpc("book_hospital_slot", [
      pid,
      hospitalAvailable[0].id,
      null,
      true,
      "Prioritet test",
      uid(121),
    ]),
  );
  assert.equal(
    await as(1, () =>
      rpc("book_hospital_slot", [
        pid,
        hospitalAvailable[0].id,
        null,
        true,
        "Prioritet test",
        uid(121),
      ]),
    ),
    hb,
  );
  await as(1, () =>
    assert.rejects(
      rpc("book_hospital_slot", [
        pid,
        hospitalAvailable[0].id,
        null,
        true,
        "Prioritet test",
        uid(122),
      ]),
    ),
  );
  assert.equal(
    (
      await as(1, () =>
        rpc("list_hospital_slots", [
          hospitalService,
          hospitalDate,
          hospitalDate,
          false,
        ]),
      )
    ).length,
    1,
  );
});
await test("hospital provider sees booking but does not gain access to full chart", async () => {
  assert.equal(
    (await as(2, () => rpc("list_hospital_bookings", ["PROVIDER", null, 0])))[0]
      .id,
    hb,
  );
  await as(2, () => assert.rejects(rpc("get_patient_chart", [pid])));
  assert.equal(
    (await as(4, () => rpc("list_hospital_bookings", ["PERSONAL", null, 0])))[0]
      .id,
    hb,
  );
  assert.equal(
    (await as(6, () => rpc("list_hospital_bookings", ["CARE", null, 0])))
      .length,
    0,
  );
  assert.equal(
    (await as(5, () => rpc("list_hospital_bookings", ["PERSONAL", null, 0])))
      .length,
    0,
  );
  await as(6, () =>
    assert.rejects(rpc("close_hospital_slot", [hospitalAvailable[0].id])),
  );
});
await test("hospital cancellation retains history and releases slot atomically", async () => {
  await as(4, () =>
    assert.rejects(
      rpc("change_hospital_booking", [hb, 2, "CANCELLED", "Testni razlog"]),
    ),
  );
  await as(4, () =>
    rpc("change_hospital_booking", [hb, 1, "CANCELLED", "Testni razlog"]),
  );
  assert.equal(
    (
      await as(1, () =>
        rpc("list_hospital_slots", [
          hospitalService,
          hospitalDate,
          hospitalDate,
          false,
        ]),
      )
    ).length,
    2,
  );
  assert.equal(
    (
      await db.query(
        "select count(*) n from hospital_booking_history where booking_id=$1",
        [hb],
      )
    ).rows[0].n,
    1,
  );
  await as(1, () => assert.rejects(db.exec("select * from hospital_bookings")));
  await assert.rejects(
    db.query("delete from hospital_bookings where id=$1", [hb]),
  );
});
await test("messaging is opt-in and restricted to patient and assigned doctor", async () => {
  await as(4, () =>
    assert.rejects(
      rpc("send_patient_message", [pid, doc, "Testna poruka", uid(130)]),
    ),
  );
  await as(2, () => assert.rejects(rpc("set_messaging_enabled", [doc, true])));
  await as(1, () => rpc("set_messaging_enabled", [doc, true]));
  const msg = await as(4, () =>
    rpc("send_patient_message", [pid, doc, "Testna poruka", uid(130)]),
  );
  assert.equal(
    await as(4, () =>
      rpc("send_patient_message", [pid, doc, "Testna poruka", uid(130)]),
    ),
    msg,
  );
  assert.equal(
    (await as(1, () => rpc("read_messages", [pid, doc, null])))[0].body,
    "Testna poruka",
  );
  await as(3, () => assert.rejects(rpc("read_messages", [pid, doc, null])));
  await as(2, () => assert.rejects(rpc("read_messages", [pid, doc, null])));
  await as(5, () => assert.rejects(rpc("read_messages", [pid, doc, null])));
  await as(6, () => assert.rejects(rpc("read_messages", [pid, doc, null])));
  await as(1, () => rpc("set_messaging_enabled", [doc, false]));
  await as(4, () =>
    assert.rejects(
      rpc("send_patient_message", [pid, doc, "Druga poruka", uid(131)]),
    ),
  );
  assert.equal(
    (await as(4, () => rpc("read_messages", [pid, doc, null]))).length,
    1,
  );
  await assert.rejects(
    db.query("update messages set body=$1 where id=$2", ["overwrite", msg]),
  );
});
const renewalTherapy = (await as(4, () => rpc("renewal_overview", [true, pid])))
  .therapies[0];
let renewal;
await test("renewal request needs doctor approval of active therapy and cannot duplicate pending request", async () => {
  await as(4, () =>
    assert.rejects(
      rpc("request_medication_renewal", [renewalTherapy.id, "Test"]),
    ),
  );
  await as(4, () =>
    assert.rejects(rpc("set_renewal_allowed", [renewalTherapy.id, true])),
  );
  await as(1, () => rpc("set_renewal_allowed", [renewalTherapy.id, true]));
  renewal = await as(4, () =>
    rpc("request_medication_renewal", [renewalTherapy.id, "Test"]),
  );
  assert.equal(
    await as(4, () =>
      rpc("request_medication_renewal", [renewalTherapy.id, "Test"]),
    ),
    renewal,
  );
  await as(3, () =>
    assert.rejects(rpc("resolve_medication_renewal", [renewal, true, "", rx])),
  );
  await as(2, () =>
    assert.rejects(rpc("resolve_medication_renewal", [renewal, true, "", rx])),
  );
});
await test("renewal approval atomically creates a patient prescription and rejects replay", async () => {
  const document = await as(1, () =>
    rpc("resolve_medication_renewal", [renewal, true, "Odobreno", rx]),
  );
  assert.equal(
    (await as(4, () => rpc("get_document", [document, "VIEW"]))).kind,
    "PRESCRIPTION",
  );
  assert.equal(
    (await as(4, () => rpc("renewal_overview", [true, pid]))).requests[0]
      .status,
    "APPROVED",
  );
  await as(1, () =>
    assert.rejects(rpc("resolve_medication_renewal", [renewal, true, "", rx])),
  );
});
const reportData = {
  report_type: "SPECIALIST",
  reported_on: new Date().toISOString().slice(0, 10),
  diagnosis: "TEST — izmišljena dijagnoza",
  content: "Izmišljeni tekst specijalističkog nalaza",
  conclusion: "Testni zaključak",
  recommendations: "Testna preporuka",
};
let medicalReport;
await test("medical reports require treating doctor and are visible only to authorized readers", async () => {
  await as(2, () =>
    assert.rejects(
      rpc("publish_medical_report", [pid, null, null, reportData, uid(140)]),
    ),
  );
  await as(3, () =>
    assert.rejects(
      rpc("publish_medical_report", [pid, null, null, reportData, uid(140)]),
    ),
  );
  medicalReport = await as(1, () =>
    rpc("publish_medical_report", [pid, null, null, reportData, uid(140)]),
  );
  assert.equal(
    (await as(4, () => rpc("list_medical_reports", [true, pid, 0])))[0].id,
    medicalReport,
  );
  await as(6, () =>
    assert.rejects(rpc("download_medical_report", [medicalReport])),
  );
  await as(5, () =>
    assert.rejects(rpc("download_medical_report", [medicalReport])),
  );
});
await test("report corrections preserve source, require reason and reject stale correction", async () => {
  await as(1, () =>
    assert.rejects(
      rpc("publish_medical_report", [
        pid,
        null,
        medicalReport,
        reportData,
        uid(141),
      ]),
    ),
  );
  const corrected = await as(1, () =>
    rpc("publish_medical_report", [
      pid,
      null,
      medicalReport,
      {
        ...reportData,
        content: "Ispravljeni testni sadržaj",
        correction_reason: "Testni razlog ispravka",
      },
      uid(141),
    ]),
  );
  assert.equal(
    (await as(4, () => rpc("download_medical_report", [medicalReport])))
      .superseded_by,
    corrected,
  );
  await as(1, () =>
    assert.rejects(
      rpc("publish_medical_report", [
        pid,
        null,
        medicalReport,
        { ...reportData, correction_reason: "Drugi ispravak" },
        uid(142),
      ]),
    ),
  );
  await assert.rejects(
    db.query("update medical_reports set content=$1 where id=$2", [
      "overwrite",
      corrected,
    ]),
  );
  await assert.rejects(
    db.query("delete from medical_reports where id=$1", [corrected]),
  );
});
console.log(`${passed} total clinical and document checks passed.`);
await db.close();
