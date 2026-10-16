import { expect, test } from "@playwright/test";
for (const mobile of [false, true])
  test(`laboratory booking selects the service, timed test and cannula sampling${mobile ? " on mobile" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    await page.route("**/src/lib/supabase.ts*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const supabase=null;export const configured=false;export function db(){return {rpc:async(name,args)=>(await fetch('/__lab_booking_fixture',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
      }),
    );
    await page.route("**/__lab_booking_fixture", async (route) => {
      const { name, args } = route.request().postDataJSON();
      calls.push({ name, args });
      let data: unknown;
      if (name === "priority_hospital_context")
        data = {
          departments: [
            {
              id: "dept-lab",
              institution_id: "hospital-1",
              institution_name: "Testna bolnica",
              name: "Laboratorij – endokrinologija",
              duration_minutes: 15,
              active: true,
            },
          ],
          services: [
            {
              id: "lab-1",
              department_id: "dept-lab",
              department_name: "Laboratorij – endokrinologija",
              institution_id: "hospital-1",
              institution_name: "Testna bolnica",
              doctor_id: "doctor-1",
              doctor_name: "dr. Test",
              name: "Laboratorij - Uzimanje venske krvi",
              specialty: "Laboratorij – endokrinologija",
              location: "Prizemlje",
              instructions: "Ponijeti uputnicu",
              active: true,
              booking_kind: "LABORATORY",
              procedure_code: "VVK",
              duration_minutes: 15,
              shifts: [{ weekday: 3, shift: "MORNING" }],
              laboratory_tests: [
                {
                  id: "test-cort",
                  code: "LOCAL-CORT",
                  name: "Bazalni kortizol",
                  required_time: "08:00:00",
                  instructions: "Slijediti pisanu uputu liječnika.",
                  active: true,
                  steps: [
                    {
                      day_offset: -1,
                      time: "20:00",
                      label: "Priprema prema protokolu",
                      instructions: "Provjeriti pisanu uputu.",
                    },
                  ],
                },
              ],
            },
          ],
        };
      else if (name === "priority_laboratory_slots")
        data = [{ starts_at: "2026-11-04T07:00:00Z", duration_minutes: 15 }];
      else if (name === "priority_hospital_referrals") data = [];
      else if (name === "search_medical_codes")
        data =
          args.catalog_id === "2.2.5"
            ? [
                {
                  list_id: "2.2.5",
                  code: "A3",
                  name: "Dijagnostička pretraga",
                  description: "Dijagnostička pretraga",
                },
              ]
            : args.catalog_id === "2.2.18"
              ? [
                  {
                    list_id: "2.2.18",
                    code: "00",
                    name: "Kapilarna krv",
                    description: "Kapilarna krv",
                  },
                ]
              : [];
      else if (name === "search_diagnosis_codes") data = [];
      else if (name === "book_priority_laboratory")
        data = { booking_id: "booking-lab", referral_id: "ref-lab" };
      else if (name === "hospital_booking_email_status") data = "UNAVAILABLE";
      else throw Error("Unexpected laboratory fixture RPC " + name);
      await route.fulfill({ json: { data, error: null } });
    });
    await page.goto("/e2e/fixtures/priority.html");
    await page
      .getByRole("combobox", { name: "Vrsta naručivanja" })
      .selectOption("LABORATORY");
    await page
      .getByRole("combobox", { name: /^Bolnica/ })
      .selectOption("hospital-1");
    await page
      .getByRole("combobox", { name: /^Odjel/ })
      .selectOption("dept-lab");
    await page
      .getByRole("combobox", { name: /^Laboratorijska usluga/ })
      .selectOption("lab-1");
    expect(calls.some((c) => c.name === "priority_laboratory_slots")).toBe(
      false,
    );
    await page
      .getByRole("combobox", { name: "Dodaj laboratorijsku pretragu" })
      .selectOption("test-cort");
    await expect(
      page.getByRole("list", { name: "Odabrane pretrage" }),
    ).toContainText("Bazalni kortizol");
    await expect(
      page.getByRole("combobox", { name: "Vrijeme uzorkovanja" }),
    ).toBeHidden();
    await page
      .getByRole("combobox", { name: "Vrsta uzorka (CEZIH)" })
      .selectOption("00");
    await expect(
      page.getByRole("list", { name: "Odabrani uzorci" }),
    ).toContainText("00 · Kapilarna krv");
    await page
      .getByRole("button", { name: "Ukloni uzorak: Kapilarna krv" })
      .click();
    await expect(
      page.getByRole("list", { name: "Odabrani uzorci" }),
    ).not.toContainText("Kapilarna krv");
    await page
      .getByRole("combobox", { name: "Vrsta uzorka (CEZIH)" })
      .selectOption("00");
    await page.screenshot({
      path: `/tmp/laboratory-booking-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
    await page
      .getByRole("combobox", { name: "Način uzimanja uzorka" })
      .selectOption("CANNULA");
    await page.getByRole("button", { name: "Nastavi na termine" }).click();
    await expect(
      page.getByRole("combobox", { name: "Dodaj laboratorijsku pretragu" }),
    ).toBeHidden();
    await page
      .getByRole("combobox", { name: "Vrijeme uzorkovanja" })
      .selectOption("2026-11-04T07:00:00Z");
    await page.getByRole("button", { name: "Natrag", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Način uzimanja uzorka" }),
    ).toHaveValue("CANNULA");
    await page.getByRole("button", { name: "Nastavi na termine" }).click();
    await expect(
      page.getByRole("combobox", { name: "Vrijeme uzorkovanja" }),
    ).toHaveValue("2026-11-04T07:00:00Z");
    await page.getByRole("button", { name: "Nastavi na uputnicu" }).click();
    await expect(
      page.getByRole("button", { name: "08:15", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/3\. 11\. 2026\. u 20:00/)).toBeVisible();
    await page
      .getByRole("combobox", { name: /^Uputnica za pregled/ })
      .selectOption("NEW");
    await page
      .getByLabel("Razlog upućivanja")
      .fill("Izmišljena testna indikacija");
    await page
      .getByLabel("Razlog prioritetnog pregleda")
      .fill("Izmišljeni testni prioritet");
    await page
      .getByRole("button", {
        name: "Potvrdi prioritetnu laboratorijsku narudžbu",
      })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Prioritetna laboratorijska narudžba je potvrđena",
    );
    const booking = calls.find((c) => c.name === "book_priority_laboratory");
    expect(booking?.args.test_ids).toEqual(["test-cort"]);
    expect(booking?.args.sampling_method).toBe("CANNULA");
    expect(booking?.args.specimen_codes).toEqual(["00"]);
    expect(booking?.args.new_referral).toMatchObject({ referral_code: "A3" });
  });
