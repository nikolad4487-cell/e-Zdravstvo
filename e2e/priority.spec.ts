import { expect, test, type Page } from "@playwright/test";
async function fixture(page: Page) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const supabase=null;export const configured=false;export function db(){return {rpc:async(name,args)=>(await fetch('/__priority_fixture',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
    }),
  );
  await page.route("**/__priority_fixture", async (route) => {
    const { name, args } = route.request().postDataJSON();
    calls.push({ name, args });
    let data: unknown;
    const service = (
      id: string,
      department: string,
      hospital: string,
      doctor: string,
    ) => ({
      id,
      department_id: department,
      institution_id: hospital,
      institution_name: "Testna bolnica",
      doctor_id: doctor,
      doctor_name: doctor,
      name: "Specijalistički pregled",
      specialty: "Kardiologija",
      location: "Ambulanta 1",
      instructions: "Ponijeti dokumentaciju",
      active: true,
      department_name: "Kardiologija",
      duration_minutes: 15,
      shifts: [{ weekday: 1, shift: "MORNING" }],
    });
    if (name === "priority_hospital_context")
      data = {
        departments: [
          {
            id: "dept-1",
            institution_id: "hospital-1",
            institution_name: "Testna bolnica",
            name: "Kardiologija",
            duration_minutes: 15,
            active: true,
          },
          {
            id: "dept-2",
            institution_id: "hospital-2",
            institution_name: "Druga bolnica",
            name: "Ortopedija",
            duration_minutes: 30,
            active: true,
          },
        ],
        services: [
          service("service-1", "dept-1", "hospital-1", "dr. Prvi"),
          service("service-2", "dept-2", "hospital-2", "dr. Drugi"),
        ],
      };
    else if (name === "priority_hospital_slots")
      data = [{ starts_at: "2026-10-26T06:00:00Z", duration_minutes: 15 }];
    else if (name === "priority_hospital_referrals")
      data = [
        {
          id: "referral-1",
          number: "EZ-UPU-TEST",
          expires_on: "2027-01-01",
          issued_at: "2026-10-11T10:00:00Z",
        },
      ];
    else if (name === "book_priority_hospital")
      data = { booking_id: "booking-1", referral_id: "referral-1" };
    else if (name === "hospital_booking_email_status") data = "UNAVAILABLE";
    else throw Error("Unexpected fixture RPC " + name);
    await route.fulfill({ json: { data, error: null } });
  });
  await page.goto("/e2e/fixtures/priority.html");
  await expect(page.getByRole("combobox", { name: /^Bolnica/ })).toBeVisible();
  return calls;
}
async function choose(page: Page) {
  await page
    .getByRole("combobox", { name: /^Bolnica/ })
    .selectOption("hospital-1");
  await page.getByRole("combobox", { name: /^Odjel/ }).selectOption("dept-1");
  await page
    .getByRole("combobox", { name: /^Specijalist/ })
    .selectOption("service-1");
  await page.getByRole("button", { name: "07:00", exact: true }).click();
}
test("booking from the open patient links an existing referral and reports email availability", async ({
  page,
}) => {
  const calls = await fixture(page);
  await choose(page);
  await expect(
    page.getByRole("button", { name: "07:15", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("combobox", { name: /^Važeća uputnica/ })
    .selectOption("referral-1");
  await page
    .getByLabel("Razlog prioritetnog pregleda", { exact: false })
    .fill("Testna indikacija pregleda");
  await page
    .getByRole("button", { name: "Potvrdi prioritetni pregled", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Prioritetni pregled je potvrđen",
  );
  await expect(page.getByRole("status")).toContainText(
    "usluga e-maila još nije aktivirana",
  );
  expect(
    calls.find((c) => c.name === "book_priority_hospital")?.args,
  ).toMatchObject({
    patient_id: "fictional-patient",
    service_id: "service-1",
    referral_id: "referral-1",
    new_referral: null,
    priority_reason: "Testna indikacija pregleda",
  });
});
test("new referral is submitted with the reservation and changing hospital clears dependent choices on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const calls = await fixture(page);
  await choose(page);
  await page
    .getByRole("combobox", { name: /^Uputnica za pregled/ })
    .selectOption("NEW");
  await page
    .getByLabel("Razlog upućivanja", { exact: false })
    .fill("Testno upućivanje pacijenta");
  await page
    .getByLabel("Razlog prioritetnog pregleda", { exact: false })
    .fill("Testna indikacija pregleda");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page
    .getByRole("combobox", { name: /^Bolnica/ })
    .selectOption("hospital-2");
  await expect(page.getByRole("combobox", { name: /^Odjel/ })).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: /^Specijalist/ }),
  ).toHaveValue("");
  await expect(
    page.getByRole("button", {
      name: "Potvrdi prioritetni pregled",
      exact: true,
    }),
  ).toBeDisabled();
  await choose(page);
  await page
    .getByLabel("Razlog upućivanja", { exact: false })
    .fill("Testno upućivanje pacijenta");
  await page
    .getByLabel("Razlog prioritetnog pregleda", { exact: false })
    .fill("Testna indikacija pregleda");
  await page
    .getByRole("button", { name: "Potvrdi prioritetni pregled", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Prioritetni pregled je potvrđen",
  );
  expect(
    calls.find((c) => c.name === "book_priority_hospital")?.args,
  ).toMatchObject({
    patient_id: "fictional-patient",
    referral_id: null,
    new_referral: { reason: "Testno upućivanje pacijenta" },
  });
});
