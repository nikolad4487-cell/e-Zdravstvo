import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, as, rpc, id, org, patient, secondPatient, otherDoc } =
  await workflowFixture();
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
try {
  const ward = await as(5, () =>
    rpc("save_inpatient_ward", [null, org, "Testni bolnički odjel", true]),
  );
  const beds = [];
  for (let n = 1; n <= 3; n++)
    beds.push(
      await as(5, () =>
        rpc("save_inpatient_bed", [null, ward, "Soba 101 / " + n, true]),
      ),
    );
  await check(
    "only administrators configure capacity, with no automatic access to clinical episodes",
    async () => {
      await assert.rejects(
        as(1, () =>
          rpc("save_inpatient_ward", [null, org, "Neovlašten odjel", true]),
        ),
        /Forbidden/,
      );
      await assert.rejects(
        as(5, () => rpc("list_inpatients")),
        /Forbidden/,
      );
      await assert.rejects(
        as(3, () => rpc("inpatient_context")),
        /Forbidden/,
      );
    },
  );
  const admit = (pid, bed, key) =>
    as(1, () =>
      rpc("admit_inpatient", [
        pid,
        bed,
        "Izmišljeni razlog bolničkog prijama",
        id(key),
      ]),
    );
  const admission = await admit(patient, beds[0], 14001);
  await check(
    "admission is idempotent and binds an initial bed even after metadata changes",
    async () => {
      assert.equal(await admit(patient, beds[0], 14001), admission);
      await assert.rejects(admit(patient, beds[1], 14001), /Request changed/);
      await as(5, () =>
        rpc("save_inpatient_bed", [
          beds[0],
          ward,
          "Preimenovana soba 101 / 1",
          true,
        ]),
      );
      assert.equal(await admit(patient, beds[0], 14001), admission);
      assert.equal(
        (await as(1, () => rpc("list_inpatients"))).items[0].bed_id,
        beds[0],
      );
    },
  );
  await check(
    "occupied bed and a second active episode for the same patient are rejected",
    async () => {
      await assert.rejects(
        admit(secondPatient, beds[0], 14002),
        /unique constraint/,
      );
      await assert.rejects(admit(patient, beds[1], 14003), /unique constraint/);
      assert.equal(
        (await db.query("select count(*)::int n from inpatient_admissions"))
          .rows[0].n,
        1,
      );
      await assert.rejects(
        as(5, () =>
          rpc("save_inpatient_bed", [beds[0], ward, "Testni krevet", false]),
        ),
        /Occupied bed/,
      );
      await assert.rejects(
        as(5, () =>
          rpc("save_inpatient_ward", [ward, org, "Testni odjel", false]),
        ),
        /Occupied ward/,
      );
    },
  );
  await check(
    "unrelated clinicians, patients and administrators cannot read or manipulate the episode",
    async () => {
      for (const n of [0, 2, 3, 4, 5, 6]) {
        await assert.rejects(
          as(n, () => rpc("inpatient_details", [admission])),
          /Forbidden|permission denied/,
        );
        await assert.rejects(
          as(n, () =>
            rpc("move_inpatient", [
              admission,
              beds[1],
              1,
              "Izmišljeni premještaj",
            ]),
          ),
          /Forbidden|permission denied/,
        );
      }
      const metadata = await as(5, () => rpc("inpatient_context"));
      assert.ok(metadata.beds.find((b) => b.id === beds[0]).occupied);
      assert.equal(JSON.stringify(metadata).includes("Testna Osoba"), false);
    },
  );
  await db
    .query(
      "insert into patient_staff(patient_id,user_id,institution_id,created_by) values($1,$2,$3,$4)",
      [patient, id(6), org, id(5)],
    )
    .catch(async (e) => {
      throw e;
    });
  await check(
    "explicitly assigned nurses record nursing notes but cannot transfer or write physician progress",
    async () => {
      assert.equal(
        (await as(6, () => rpc("inpatient_details", [admission]))).can_nurse,
        true,
      );
      await assert.rejects(
        as(6, () =>
          rpc("add_inpatient_note", [
            admission,
            "PROGRESS",
            "Neovlašteni liječnički tijek",
            id(14004),
          ]),
        ),
        /Forbidden/,
      );
      await assert.rejects(
        as(6, () =>
          rpc("move_inpatient", [
            admission,
            beds[1],
            1,
            "Izmišljeni premještaj",
          ]),
        ),
        /Forbidden/,
      );
    },
  );
  const note = await as(6, () =>
    rpc("add_inpatient_note", [
      admission,
      "NURSING",
      "Izmišljena sestrinska bilješka",
      id(14005),
    ]),
  );
  await check(
    "notes are immutable, idempotent and corrected as linked versions",
    async () => {
      assert.equal(
        await as(6, () =>
          rpc("add_inpatient_note", [
            admission,
            "NURSING",
            "Izmišljena sestrinska bilješka",
            id(14005),
          ]),
        ),
        note,
      );
      await assert.rejects(
        as(6, () =>
          rpc("add_inpatient_note", [
            admission,
            "NURSING",
            "Promijenjen sadržaj",
            id(14005),
          ]),
        ),
        /Request changed/,
      );
      await assert.rejects(
        db.query("update inpatient_notes set content='forged' where id=$1", [
          note,
        ]),
        /immutable/,
      );
      const corrected = await as(6, () =>
        rpc("add_inpatient_note", [
          admission,
          "NURSING",
          "Ispravljena testna bilješka",
          id(14006),
          note,
          "Ispravak testnog unosa",
        ]),
      );
      assert.equal(
        (
          await db.query(
            "select superseded_by from inpatient_notes where id=$1",
            [note],
          )
        ).rows[0].superseded_by,
        corrected,
      );
      assert.equal(
        (await as(6, () => rpc("inpatient_details", [admission]))).notes_total,
        2,
      );
      const authorBefore = (
        await as(6, () => rpc("inpatient_details", [admission]))
      ).notes.find((n) => n.id === note).author;
      await db.query(
        "update profiles set first_name='Promijenjeno ime' where id=$1",
        [id(6)],
      );
      assert.equal(
        (await as(6, () => rpc("inpatient_details", [admission]))).notes.find(
          (n) => n.id === note,
        ).author,
        authorBefore,
      );
    },
  );
  const otherAdmission = await admit(secondPatient, beds[1], 14007);
  await check(
    "active care-team physicians can continue care without changing the admission author",
    async () => {
      const detail = await as(2, () =>
        rpc("inpatient_details", [otherAdmission]),
      );
      assert.equal(detail.can_manage, true);
      assert.equal(detail.can_doctor_note, true);
      await as(2, () =>
        rpc("add_inpatient_note", [
          otherAdmission,
          "PROGRESS",
          "Izmišljena timska bilješka",
          id(14010),
        ]),
      );
      const paths = await as(1, () =>
        rpc("care_pathways", [patient, "", "HOSPITALIZED", false, 0]),
      );
      assert.ok(paths.items.some((i) => i.source_id === admission));
      const followupDay = (
        await db.query(
          "select (now() at time zone 'Europe/Zagreb')::date::text d",
        )
      ).rows[0].d;
      const reminder = await as(1, () =>
        rpc("create_care_followup", [
          patient,
          followupDay,
          "Provjeriti bolnički tijek",
          id(14011),
          "INPATIENT",
          admission,
        ]),
      );
      assert.ok(reminder);
    },
  );
  await check(
    "notes paginate without omitting older entries and corrections",
    async () => {
      for (let n = 0; n < 52; n++)
        await as(6, () =>
          rpc("add_inpatient_note", [
            admission,
            "NURSING",
            "Testna bilješka " + n,
            id(14200 + n),
          ]),
        );
      const first = await as(6, () => rpc("inpatient_details", [admission, 0])),
        second = await as(6, () => rpc("inpatient_details", [admission, 1]));
      assert.equal(first.notes_total, 54);
      assert.equal(first.notes.length, 50);
      assert.equal(second.notes.length, 4);
      assert.equal(
        new Set([...first.notes, ...second.notes].map((n) => n.id)).size,
        54,
      );
    },
  );
  await check(
    "failed and stale transfers preserve the original bed and history",
    async () => {
      await assert.rejects(
        as(1, () =>
          rpc("move_inpatient", [
            admission,
            beds[1],
            1,
            "Izmišljeni premještaj",
          ]),
        ),
        /unique constraint/,
      );
      assert.equal(
        (
          await db.query(
            "select bed_id from inpatient_admissions where id=$1",
            [admission],
          )
        ).rows[0].bed_id,
        beds[0],
      );
      await as(1, () =>
        rpc("move_inpatient", [
          admission,
          beds[2],
          1,
          "Izmišljeni odobreni premještaj",
        ]),
      );
      await assert.rejects(
        as(1, () =>
          rpc("move_inpatient", [
            admission,
            beds[0],
            1,
            "Stari testni zahtjev",
          ]),
        ),
        /Admission changed/,
      );
      const detail = await as(1, () => rpc("inpatient_details", [admission]));
      assert.equal(detail.movements.length, 2);
      assert.ok(detail.movements[0].to_bed.includes("Soba 101 / 1"));
      assert.equal(detail.admission.bed_id, beds[2]);
      assert.equal(await admit(patient, beds[0], 14001), admission);
    },
  );
  await check(
    "discharge requires a matching current discharge report and releases the bed atomically",
    async () => {
      await assert.rejects(
        as(1, () => rpc("discharge_inpatient", [admission, 2, id(99999)])),
        /discharge report/,
      );
      const today = (
        await db.query(
          "select (now() at time zone 'Europe/Zagreb')::date::text d",
        )
      ).rows[0].d;
      const report = await as(1, () =>
        rpc("publish_medical_report", [
          patient,
          null,
          null,
          {
            report_type: "DISCHARGE",
            reported_on: today,
            content: "Izmišljeno otpusno pismo",
            admission_id: admission,
          },
          id(14008),
        ]),
      );
      await as(1, () => rpc("discharge_inpatient", [admission, 2, report]));
      const detail = await as(1, () => rpc("inpatient_details", [admission]));
      assert.equal(detail.admission.status, "DISCHARGED");
      assert.equal(detail.admission.discharge_report_id, report);
      assert.equal(detail.movements.length, 3);
      assert.equal(
        (await as(5, () => rpc("inpatient_context"))).beds.find(
          (b) => b.id === beds[2],
        ).occupied,
        false,
      );
      await assert.rejects(
        as(6, () =>
          rpc("add_inpatient_note", [
            admission,
            "NURSING",
            "Zakašnjela bilješka",
            id(14009),
          ]),
        ),
        /closed/,
      );
      await assert.rejects(
        db.query(
          "update inpatient_admissions set status='ADMITTED' where id=$1",
          [admission],
        ),
        /immutable/,
      );
    },
  );
  await check(
    "hospital reports use the authenticated hospital profile and cannot be rebound to another episode",
    async () => {
      const anotherOrg = id(14500),
        hospitalDoctor = id(14501);
      await db.query(
        "insert into institutions(id,name,code) values($1,'Druga izmišljena bolnica','INPATIENT2')",
        [anotherOrg],
      );
      await db.query(
        "insert into institution_users(institution_id,user_id) values($1,$2)",
        [anotherOrg, id(1)],
      );
      await db.query(
        "insert into user_roles(user_id,role,institution_id) values($1,'DOCTOR',$2)",
        [id(1), anotherOrg],
      );
      await db.query(
        "insert into doctors(id,user_id,institution_id,display_name,specialty) values($1,$2,$3,'dr. Bolnički test','Interna medicina')",
        [hospitalDoctor, id(1), anotherOrg],
      );
      const hospitalWard = await as(5, () =>
        rpc("save_inpatient_ward", [null, anotherOrg, "Bolnički odjel", true]),
      );
      const hospitalBed = await as(5, () =>
        rpc("save_inpatient_bed", [null, hospitalWard, "Testni krevet", true]),
      );
      const nextAdmission = await admit(patient, hospitalBed, 14502);
      const today = (
        await db.query(
          "select (now() at time zone 'Europe/Zagreb')::date::text d",
        )
      ).rows[0].d;
      const discharge = await as(1, () =>
        rpc("publish_medical_report", [
          patient,
          null,
          null,
          {
            admission_id: nextAdmission,
            report_type: "DISCHARGE",
            reported_on: today,
            content: "Drugo izmišljeno otpusno pismo",
          },
          id(14503),
        ]),
      );
      const stored = (
        await db.query(
          "select doctor_id,institution_id,inpatient_admission_id from medical_reports where id=$1",
          [discharge],
        )
      ).rows[0];
      assert.equal(stored.doctor_id, hospitalDoctor);
      assert.equal(stored.institution_id, anotherOrg);
      assert.equal(stored.inpatient_admission_id, nextAdmission);
      await as(1, () =>
        rpc("discharge_inpatient", [nextAdmission, 1, discharge]),
      );
      const third = await admit(patient, hospitalBed, 14504);
      await assert.rejects(
        as(1, () =>
          rpc("publish_medical_report", [
            patient,
            null,
            discharge,
            {
              admission_id: third,
              report_type: "DISCHARGE",
              reported_on: today,
              content: "Pogrešno vezan ispravak",
              correction_reason: "Izmišljeni ispravak za test",
            },
            id(14505),
          ]),
        ),
        /correction episode/,
      );
      await assert.rejects(
        as(1, () =>
          rpc("move_inpatient", [
            third,
            beds[0],
            1,
            "Pokušaj premještaja u drugu ustanovu",
          ]),
        ),
        /Invalid transfer/,
      );
      await db.query(
        "insert into patient_doctors(patient_id,doctor_id) values($1,$2) on conflict do nothing",
        [patient, otherDoc],
      );
      const limited = (
        await as(2, () =>
          rpc("care_pathways", [patient, "", "HOSPITALIZED", false, 0]),
        )
      ).items.find((r) => r.source_id === third);
      assert.ok(limited);
      assert.equal(limited.can_inpatient_details, false);
      await assert.rejects(
        as(2, () => rpc("inpatient_details", [third])),
        /Forbidden/,
      );
    },
  );
  await check(
    "revoking care removes nurse access immediately and no direct table bypass is possible",
    async () => {
      await db.query(
        "update patient_staff set revoked_at=now() where patient_id=$1 and user_id=$2",
        [patient, id(6)],
      );
      await assert.rejects(
        as(6, () => rpc("inpatient_details", [admission])),
        /Forbidden/,
      );
      await assert.rejects(
        as(1, () => db.query("select * from inpatient_admissions")),
        /permission denied/,
      );
      assert.equal(
        (
          await as(1, () => rpc("list_inpatients", [null, "", false, 0]))
        ).items.some((a) => a.id === admission),
        false,
      );
      assert.ok(
        (
          await as(1, () => rpc("list_inpatients", [null, "", true, 0]))
        ).items.some((a) => a.id === admission),
      );
    },
  );
  assert.ok(otherAdmission);
  assert.ok(otherDoc);
  console.log(`${checks} inpatient workflow checks passed`);
} finally {
  await db.close();
}
