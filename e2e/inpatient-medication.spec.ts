import { test, expect } from "@playwright/test";
for (const mobile of [false, true])
  test(`hospital medication order, administration, correction and stop${mobile ? " mobile" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let order: Record<string, unknown> | null = null;
    const records: Record<string, unknown>[] = [];
    await page.route("**/src/lib/supabase.ts*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const supabase=null;export const configured=false;const channels=new Set();window.__therapyRevision=()=>{for(const c of channels)for(const cb of c.callbacks)cb();};const client={rpc:async(name,args)=>(await fetch('/__therapy_fixture',{method:'POST',body:JSON.stringify({name,args})})).json(),channel(){const callbacks=new Set();const c={callbacks,on(...a){callbacks.add(a.at(-1));return c;},subscribe(){channels.add(c);return c;}};return c;},removeChannel(c){channels.delete(c);return Promise.resolve('ok');}};export function db(){return client;}`,
      }),
    );
    await page.route("**/__therapy_fixture", async (route) => {
      const { name, args } = route.request().postDataJSON();
      calls.push({ name, args });
      let data: unknown = null;
      if (name === "inpatient_medications")
        data = {
          can_order: true,
          can_record: true,
          admission_status: "ADMITTED",
          total: order ? 1 : 0,
          orders: order ? [order] : [],
        };
      else if (name === "search_prescription_medications")
        data = [
          {
            id: "medicine-test",
            name: "Izmišljeni lijek",
            active_ingredient: "Test",
            strength: "Testna jačina",
            form: "Test",
            packaging: "Testno pakiranje",
            route: "Testni put",
            catalog_code: "TEST",
            catalog_list: null,
            catalog_metadata: {},
          },
        ];
      else if (name === "create_inpatient_medication_order") {
        expect(args).toMatchObject({
          admission_id: "admission-test",
          medication_id: "medicine-test",
          dose: "Testna doza",
          route: "Testni put",
          scheduled_times: ["2026-10-29T12:00"],
        });
        order = {
          id: "order-test",
          dose: args.dose,
          route: args.route,
          instructions: args.instructions,
          medication_snapshot: {
            name: "Izmišljeni lijek",
            strength: "Testna jačina",
            packaging: "Testno pakiranje",
            catalog_code: "TEST",
          },
          status: "ACTIVE",
          version: 1,
          author_name: "dr. Test",
          created_at: "2026-10-29T08:00:00Z",
          stop_reason: null,
          stop_author: null,
          stopped_at: null,
          doses: [
            {
              id: "dose-test",
              scheduled_at: "2026-10-29T11:00:00Z",
              record: null,
            },
          ],
        };
        data = "order-test";
      } else if (name === "record_inpatient_medication") {
        expect(args.dose_id).toBe("dose-test");
        if (args.corrects_record_id) {
          expect(args.corrects_record_id).toBe("record-1");
          records[0].superseded_by = "record-2";
        } else {
          expect(args.patient_confirmed).toBe(true);
          expect(args.actual_dose).toBe("Testna doza");
        }
        const record = {
          id: "record-" + (records.length + 1),
          dose_id: "dose-test",
          outcome: args.outcome,
          actual_at: "2026-10-29T11:00:00Z",
          actual_dose: args.outcome === "GIVEN" ? args.actual_dose : null,
          note: args.note,
          author_name: "Testna Sestra",
          created_at: "2026-10-29T11:01:00Z",
          corrects_record_id: args.corrects_record_id,
          superseded_by: null,
          correction_reason: args.correction_reason,
          can_correct: true,
          scheduled_at: "2026-10-29T11:00:00Z",
        };
        records.push(record);
        (order!.doses as { record: unknown }[])[0].record = record;
        data = record.id;
      } else if (name === "stop_inpatient_medication_order") {
        expect(args.expected_version).toBe(1);
        Object.assign(order!, {
          status: "STOPPED",
          version: 2,
          stop_reason: args.reason,
          stop_author: "dr. Test",
          stopped_at: "2026-10-29T12:00:00Z",
        });
      } else if (name === "inpatient_medication_history")
        data = { total: records.length, records: [...records].reverse() };
      else throw Error("Unexpected medication RPC " + name);
      await route.fulfill({ json: { data, error: null } });
    });
    await page.goto("/e2e/fixtures/inpatient.html?medication");
    await page.getByRole("button", { name: "Novi terapijski nalog" }).click();
    await page.getByLabel("Lijek iz šifrarnika").selectOption("medicine-test");
    await page.getByLabel("Propisana pojedinačna doza").fill("Testna doza");
    await page.getByLabel("Put primjene").fill("Testni put");
    await page.getByLabel("Uputa liječnika").fill("Izmišljena uputa za test");
    await page.getByLabel(/^Doza 1/).fill("2026-10-29T12:00");
    await page.evaluate(() => {
      (
        window as unknown as { __therapyRevision: () => void }
      ).__therapyRevision();
    });
    await expect(page.getByLabel("Propisana pojedinačna doza")).toHaveValue(
      "Testna doza",
    );
    await page.getByRole("button", { name: "Spremi terapijski zapis" }).click();
    await expect(
      page.getByRole("heading", { name: "Izmišljeni lijek" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Evidentiraj ishod doze", exact: true })
      .click();
    await page
      .getByLabel("Stvarni datum i vrijeme ishoda")
      .fill("2026-10-29T12:00");
    // Client confirmation prevents a premature RPC.
    await page.getByRole("button", { name: "Spremi terapijski zapis" }).click();
    await expect(
      page.getByText(
        "Za primjenu unesite stvarnu dozu i potvrdite provjeru identiteta i naloga.",
      ),
    ).toBeVisible();
    expect(
      calls.filter((c) => c.name === "record_inpatient_medication"),
    ).toHaveLength(0);
    await page.getByRole("checkbox", { name: /Provjerio/ }).check();
    await page.getByRole("button", { name: "Spremi terapijski zapis" }).click();
    await expect(
      page.getByText("Primijenjeno: Testna doza", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Ispravi vlastiti zapis primjene" })
      .click();
    await page.getByLabel(/^Ishod/).selectOption("NOT_GIVEN");
    await page
      .getByLabel("Napomena / razlog")
      .fill("Izmišljeni razlog neprimjene");
    await page
      .getByLabel("Razlog ispravka zapisa")
      .fill("Izmišljeni ispravak prethodnog zapisa");
    await page.getByRole("button", { name: "Spremi terapijski zapis" }).click();
    await expect(
      page.getByText("Nije primijenjeno", { exact: false }).first(),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Povijest primjena i ispravaka" })
      .click();
    await expect(page.getByLabel("Povijest terapijskih zapisa")).toContainText(
      "prethodna verzija",
    );
    await page
      .getByRole("button", { name: "Zaustavi nalog", exact: true })
      .click();
    await page
      .getByLabel("Razlog zaustavljanja")
      .fill("Izmišljeni razlog zaustavljanja");
    await page.getByRole("button", { name: "Spremi terapijski zapis" }).click();
    await expect(
      page.getByText("Zaustavljen nalog", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Evidentiraj ishod doze", exact: true }),
    ).toBeHidden();
    expect(
      calls.filter((c) => c.name === "record_inpatient_medication"),
    ).toHaveLength(2);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/inpatient-medication-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
  });
