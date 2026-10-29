import { test, expect } from "@playwright/test";
for (const mobile of [false, true])
  test(`admission, care note, transfer and discharge${mobile ? " on mobile" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let admitted = false,
      status = "ADMITTED",
      bed = "bed-1",
      version = 1;
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const notes: {
      id: string;
      kind: string;
      content: string;
      corrects_note_id: null;
      superseded_by: null;
      correction_reason: string;
      created_at: string;
      author: string;
      can_correct: boolean;
    }[] = [];
    const row = () => ({
      id: "admission-test",
      patient_id: "patient-test",
      doctor_id: "doctor-test",
      institution_id: "org-test",
      bed_id: bed,
      reason: "Testni bolnički prijam",
      status,
      admitted_at: "2026-10-28T08:00:00Z",
      discharged_at: status === "DISCHARGED" ? "2026-10-28T12:00:00Z" : null,
      discharge_report_id: status === "DISCHARGED" ? "report-test" : null,
      version,
      patient_name: "Testna Osoba",
      patient_number: "EZ-PAC-TEST",
      ward_name: "Testni odjel",
      bed_label: bed === "bed-1" ? "Soba 101" : "Soba 102",
      institution_name: "Izmišljena bolnica",
      can_manage: true,
    });
    await page.route("**/src/lib/supabase.ts*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const supabase=null;export const configured=false;
const channels=new Set();window.__inpatientRevision=()=>{for(const c of channels)for(const cb of c.callbacks)cb();};
const client={rpc:async(name,args)=>(await fetch('/__inpatient_fixture',{method:'POST',body:JSON.stringify({name,args})})).json(),channel(){const callbacks=new Set();const c={callbacks,on(...args){callbacks.add(args.at(-1));return c;},subscribe(){channels.add(c);return c;}};return c;},removeChannel(c){channels.delete(c);return Promise.resolve('ok');}};
export function db(){return client;}
`,
      }),
    );
    await page.route("**/__inpatient_fixture", async (route) => {
      const { name, args } = route.request().postDataJSON();
      calls.push({ name, args });
      let data: unknown;
      if (name === "inpatient_context")
        data = {
          institutions: [
            { id: "org-test", name: "Izmišljena bolnica", can_manage: false },
          ],
          wards: [
            {
              id: "ward-test",
              institution_id: "org-test",
              name: "Testni odjel",
              active: true,
            },
          ],
          beds: ["bed-1", "bed-2"].map((id, i) => ({
            id,
            ward_id: "ward-test",
            institution_id: "org-test",
            label: i ? "Soba 102" : "Soba 101",
            active: true,
            occupied: admitted && status === "ADMITTED" && id === bed,
            ward_name: "Testni odjel",
          })),
        };
      else if (name === "list_inpatients")
        data = {
          total:
            admitted && (status === "ADMITTED" || args.include_discharged)
              ? 1
              : 0,
          items:
            admitted && (status === "ADMITTED" || args.include_discharged)
              ? [row()]
              : [],
        };
      else if (name === "admit_inpatient") {
        expect(args).toMatchObject({
          patient_id: "patient-test",
          bed_id: "bed-1",
          reason: "Testni bolnički prijam",
        });
        admitted = true;
        data = "admission-test";
      } else if (name === "inpatient_details")
        data = {
          admission: row(),
          can_manage: true,
          can_doctor_note: true,
          can_nurse: false,
          notes_total: notes.length,
          notes,
          movements: [],
          discharge_reports: [
            {
              id: "report-test",
              number: "EZ-NAL-TEST",
              reported_on: "2026-10-28",
            },
          ],
        };
      else if (name === "add_inpatient_note") {
        notes.push({
          id: "note-test",
          kind: args.kind,
          content: args.content,
          corrects_note_id: null,
          superseded_by: null,
          correction_reason: "",
          created_at: "2026-10-28T08:30:00Z",
          author: "dr. Test",
          can_correct: true,
        });
        data = "note-test";
      } else if (name === "move_inpatient") {
        expect(args.expected_version).toBe(version);
        expect(args.bed_id).toBe("bed-2");
        bed = "bed-2";
        version++;
        data = null;
      } else if (name === "discharge_inpatient") {
        expect(args).toMatchObject({
          admission_id: "admission-test",
          expected_version: version,
          report_id: "report-test",
        });
        status = "DISCHARGED";
        version++;
        data = null;
      } else throw Error("Unexpected inpatient RPC " + name);
      await route.fulfill({ json: { data, error: null } });
    });
    await page.goto("/e2e/fixtures/inpatient.html");
    await page
      .getByRole("button", { name: "Novi bolnički prijam", exact: true })
      .click();
    await page.getByLabel("Slobodan krevet").selectOption("bed-1");
    await page
      .getByLabel("Razlog bolničkog prijama")
      .fill("Testni bolnički prijam");
    await page
      .getByRole("button", { name: "Potvrdi prijam", exact: true })
      .click();
    await page.getByRole("button", { name: "Otvori bolničku skrb" }).click();
    await page.getByRole("button", { name: "Nova bilješka skrbi" }).click();
    await page
      .getByLabel("Sadržaj bilješke")
      .fill("Izmišljeni liječnički tijek");
    await Promise.all([
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/__inpatient_fixture") &&
          r.request().postDataJSON()?.name === "list_inpatients",
      ),
      page.evaluate(() => {
        (
          window as unknown as { __inpatientRevision: () => void }
        ).__inpatientRevision();
      }),
    ]);
    await expect(page.getByLabel("Sadržaj bilješke")).toHaveValue(
      "Izmišljeni liječnički tijek",
    );

    await page.getByRole("button", { name: "Spremi promjenu" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Izmišljeni liječnički tijek",
    );
    await page.getByRole("button", { name: "Premjesti pacijenta" }).click();
    await page.getByLabel("Novi krevet").selectOption("bed-2");
    await page
      .getByLabel("Razlog premještaja")
      .fill("Testni odobreni premještaj");
    await page.getByRole("button", { name: "Spremi promjenu" }).click();
    await page
      .getByRole("button", { name: "Otpusti pacijenta", exact: true })
      .click();
    await page.getByLabel("Izdano otpusno pismo").selectOption("report-test");
    await page.getByRole("button", { name: "Spremi promjenu" }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "Pacijent je otpušten",
    );
    await expect(
      page.getByRole("button", { name: "Preuzmi izvorno otpusno pismo" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Premjesti pacijenta" }),
    ).toBeHidden();
    expect(calls.filter((c) => c.name === "discharge_inpatient")).toHaveLength(
      1,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/inpatient-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
    let discardPrompt = false;
    page.on("dialog", (d) => {
      discardPrompt = true;
      void d.dismiss();
    });
    await page.getByRole("button", { name: "Zatvori", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    expect(discardPrompt).toBe(false);
  });
