import { test, expect } from "@playwright/test";
for (const mobile of [false, true])
  test(`laboratory reception, recollection and processing${mobile ? " on mobile" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let stage = "EXPECTED",
      version = 1,
      attempt = 0;
    const history: {
      id: string;
      status: string;
      attempt: number;
      reason: string;
      created_at: string;
      actor: string;
    }[] = [];
    await page.route("**/src/lib/supabase.ts*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const supabase=null;export const configured=false;export function db(){return {rpc:async(name,args)=>(await fetch('/__worklist',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
      }),
    );
    await page.route("**/__worklist", async (route) => {
      const { name, args } = route.request().postDataJSON();
      calls.push({ name, args });
      let data: unknown;
      if (name === "laboratory_context")
        data = [{ id: "lab-org", name: "Izmišljeni laboratorij" }];
      else if (name === "laboratory_worklist")
        data = {
          institutions: [{ id: "lab-org", name: "Izmišljeni laboratorij" }],
          total: 1,
          counts: { [stage]: 1 },
          items: [
            {
              source_kind: "BOOKING",
              source_id: "booking-test",
              booking_id: "booking-test",
              order_id: stage === "EXPECTED" ? null : "order-test",
              number: "EZ-LAB-TEST-1",
              patient_name: "Testna Osoba",
              patient_number: "EZ-PAC-TEST",
              institution_id: "lab-org",
              institution_name: "Izmišljeni laboratorij",
              service_name: "Laboratorijske pretrage",
              location: "Prizemlje",
              doctor_name: "dr. Test",
              starts_at: "2026-10-16T06:00:00Z",
              priority: true,
              version,
              stage,
              attempt,
              stage_at: history.at(-1)?.created_at ?? null,
              sample_note:
                stage === "RECOLLECT" ? "Neispravan testni uzorak" : "",
              requested_tests: "KKS, TSH",
              specimens: [{ code: "00", name: "Kapilarna krv" }],
              sampling_method: "OTHER",
              history: [...history].reverse(),
            },
          ],
        };
      else if (name === "advance_laboratory_workflow") {
        expect(args.source_kind).toBe("BOOKING");
        expect(args.source_id).toBe("booking-test");
        expect(args.expected_version).toBe(version);
        stage = args.new_stage;
        version++;
        if (stage === "COLLECTED") attempt++;
        history.push({
          id: String(version),
          status: stage,
          attempt,
          reason: args.reason,
          created_at: new Date().toISOString(),
          actor: "Testni tehničar",
        });
        data = "order-test";
      } else if (name === "search_laboratory")
        data = [
          {
            id: "order-test",
            number: "EZ-LAB-TEST-1",
            patient_id: "test-patient",
            patient_name: "Testna Osoba",
            patient_number: "EZ-PAC-TEST",
            birth_date: "2000-01-01",
            doctor_name: "dr. Test",
            laboratory_name: "Izmišljeni laboratorij",
            requested_tests: "KKS, TSH",
            clinical_question: "",
            priority: "URGENT",
            status: "IN_PROGRESS",
            version,
            created_at: new Date().toISOString(),
            cancellation_reason: null,
            can_publish: true,
            can_cancel: false,
            results: [],
            sample_collected_at: "2026-10-16T06:05:00Z",
          },
        ];
      else if (name === "search_medical_codes") data = [];
      else throw Error("Unexpected RPC " + name);
      await route.fulfill({ json: { data, error: null } });
    });
    await page.goto("/e2e/fixtures/laboratory-worklist.html");
    await expect(
      page.getByRole("heading", {
        name: "Dnevni raspored i uzorci",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel(/^Datum rasporeda/).fill("2026-10-16");
    await page.getByLabel("Pacijent ili pretraga", { exact: true }).fill("TSH");
    await page
      .getByRole("button", { name: "Prikaži raspored", exact: true })
      .click();
    await expect
      .poll(
        () =>
          calls.filter((c) => c.name === "laboratory_worklist").at(-1)?.args,
      )
      .toMatchObject({
        work_day: "2026-10-16",
        search_term: "TSH",
        page_number: 0,
      });
    async function act(label: string, reason?: string) {
      await page.getByRole("button", { name: label, exact: true }).click();
      const dialog = page.getByRole("dialog");
      if (reason)
        await dialog.getByLabel("Razlog ponovnog uzorkovanja").fill(reason);
      await dialog.getByRole("button", { name: "Potvrdi promjenu" }).click();
      await expect(dialog).toBeHidden();
    }
    await act("Zaprimi pacijenta");
    await act("Evidentiraj uzorak");
    await act("Pokreni obradu");
    await page
      .getByRole("button", { name: "Zatraži novi uzorak", exact: true })
      .click();
    const modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "Potvrdi promjenu" }).click();
    expect(
      calls.filter((c) => c.name === "advance_laboratory_workflow"),
    ).toHaveLength(3);
    await modal
      .getByLabel("Razlog ponovnog uzorkovanja")
      .fill("Neispravan testni uzorak");
    await modal.getByRole("button", { name: "Potvrdi promjenu" }).click();
    await expect(modal).toBeHidden();
    await act("Evidentiraj novi uzorak");
    await act("Pokreni obradu");
    await expect(
      page.getByText("Uzorkovanje: 2.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Detalji i povijest", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Neispravan testni uzorak",
    );
    await expect(page.getByRole("dialog")).toContainText("Testni tehničar");
    await page.getByRole("button", { name: "Zatvori", exact: true }).click();
    await page.screenshot({
      path: `/tmp/lab-worklist-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Unesi rezultate", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveAttribute(
      "aria-label",
      "Novi laboratorijski nalaz",
    );
    await expect(page.getByLabel(/Datum uzorkovanja/)).toHaveValue(
      /2026-10-16T/,
    );
    expect(
      calls.filter((c) => c.name === "advance_laboratory_workflow"),
    ).toHaveLength(6);
  });
