import { expect, test, type Page } from "@playwright/test";
async function fixture(
  page: Page,
  options: { canWrite?: boolean; error?: string } = {},
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const patient = {
    id: "fictional-patient",
    patient_number: "TEST-001",
    first_name: "Testna",
    last_name: "Osoba",
    birth_date: "2000-01-01",
    sex: "F",
    user_id: "patient-account",
    institution_id: "test-institution",
    address: "Testna ulica 1",
    city: "Zagreb",
    postal_code: "10000",
    phone: "099000000",
    email: "fictional@example.test",
    emergency_contact: null,
    insurance: "Test",
    created_at: "2026-01-01T00:00:00Z",
  };
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const supabase=null;export const configured=false;export function db(){return {rpc:async(name,args)=>(await fetch('/__patient_editing_fixture',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
    }),
  );
  await page.route("**/__patient_editing_fixture", async (route) => {
    const { name, args } = route.request().postDataJSON();
    calls.push({ name, args });
    let data: unknown = null,
      error: unknown = null;
    if (name === "get_patient_chart")
      data = {
        patient,
        record: null,
        doctors: [],
        allergies: [],
        encounters: [],
        diagnoses: [],
        therapy: [],
        can_write: options.canWrite ?? true,
      };
    else if (name === "update_patient_details") {
      if (options.error)
        error = { code: options.error, message: "Fixture error" };
      else Object.assign(patient, args.data);
    } else throw new Error("Unexpected fixture RPC " + name);
    await route.fulfill({ json: { data, error } });
  });
  await page.goto("/e2e/fixtures/patient-editing.html");
  await expect(
    page.getByRole("heading", { name: "Testna Osoba", exact: true }),
  ).toBeVisible();
  return calls;
}
test("doctor edits existing patient, preserves identity and sees refreshed chart", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page
    .getByRole("button", { name: "Uredi pacijenta", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Uredi pacijenta" });
  await expect(dialog.getByLabel("Ime", { exact: false }).first()).toHaveValue(
    "Testna",
  );
  await dialog.getByLabel(/^Ime/).fill("Ana");
  await dialog.getByLabel(/^Telefon/).fill("099111111");
  await dialog.getByLabel(/^Grad/).fill("Split");
  await dialog.getByRole("button", { name: "Spremi promjene" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Ana Osoba", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Podaci pacijenta su spremljeni",
  );
  const call = calls.find((c) => c.name === "update_patient_details")!;
  expect(call.args.patient_id).toBe("fictional-patient");
  expect(call.args.expected_data).toMatchObject({
    first_name: "Testna",
    phone: "099000000",
    emergency_contact: null,
  });
  expect(call.args.data).toMatchObject({
    first_name: "Ana",
    phone: "099111111",
    city: "Split",
  });
  expect(call.args.data).not.toHaveProperty("user_id");
  expect(call.args.data).not.toHaveProperty("patient_number");
});
test("read-only chart does not expose patient editing", async ({ page }) => {
  const calls = await fixture(page, { canWrite: false });
  await expect(
    page.getByRole("button", { name: "Uredi pacijenta", exact: true }),
  ).toHaveCount(0);
  expect(calls.every((c) => c.name !== "update_patient_details")).toBe(true);
});
test("stale or revoked changes preserve the form and show useful errors", async ({
  page,
}) => {
  const calls = await fixture(page, { error: "40001" });
  await page
    .getByRole("button", { name: "Uredi pacijenta", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Uredi pacijenta" });
  await dialog.getByLabel(/^Ime/).fill("Ana");
  await dialog.getByRole("button", { name: "Spremi promjene" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "u međuvremenu izmijenjen",
  );
  await expect(dialog.getByLabel(/^Ime/)).toHaveValue("Ana");
  expect(calls.filter((c) => c.name === "update_patient_details")).toHaveLength(
    1,
  );
});
test("cancelling an edit does not save and preserves the chart", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page
    .getByRole("button", { name: "Uredi pacijenta", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Uredi pacijenta" });
  await dialog.getByLabel(/^Ime/).fill("Ana");
  await dialog.getByRole("button", { name: "Odustani", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Testna Osoba", exact: true }),
  ).toBeVisible();
  expect(calls.some((c) => c.name === "update_patient_details")).toBe(false);
});
