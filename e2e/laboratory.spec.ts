import { expect, test, type Page } from "@playwright/test";

async function laboratoryFixture(page: Page) {
  const calls: Record<string, unknown>[] = [];
  // Replace only the fixture's database module. No real accounts or remote requests.
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const supabase = null; export const configured = false;
      export function db() { return {rpc: async (name, args) => {
        const response = await fetch('/__laboratory_fixture', {method:'POST',body:JSON.stringify({name,args})});
        return response.json();
      }}; }`,
    }),
  );
  await page.route("**/__laboratory_fixture", async (route) => {
    const { name, args } = route.request().postDataJSON();
    expect(name).toBe("search_laboratory");
    calls.push(args);
    const count = args.search_term ? 1 : args.page_number ? 2 : 50;
    const rows = Array.from({ length: count }, (_, i) => ({
      id: `test-order-${args.page_number}-${i}`,
      number: args.search_term
        ? "EZ-LAB-STARI"
        : `EZ-LAB-${args.page_number}-${i}`,
      patient_id: "fictional-patient",
      patient_name: "Izmišljena Osoba",
      patient_number: "TEST-001",
      birth_date: "2000-01-01",
      doctor_name: "dr. Test",
      laboratory_name: "Testni laboratorij",
      requested_tests: "Glukoza",
      clinical_question: "",
      priority: args.priority_filter || "REGULAR",
      status: args.status_filter || "ORDERED",
      version: 1,
      created_at: "2026-01-10T10:00:00Z",
      cancellation_reason: null,
      can_publish: false,
      can_cancel: false,
      results: [],
    }));
    await route.fulfill({ json: { data: rows, error: null } });
  });
  await page.goto("/e2e/fixtures/laboratory.html");
  await expect(
    page.getByRole("heading", { name: "EZ-LAB-0-0", exact: true }),
  ).toBeVisible();
  return calls;
}

test("laboratory filters search the server, reset pagination and can be cleared", async ({
  page,
}) => {
  const calls = await laboratoryFixture(page);
  await page.getByRole("button", { name: "Sljedeća", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "EZ-LAB-1-0", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sljedeća", exact: true }),
  ).toBeDisabled();
  await page
    .getByLabel("Pretraži narudžbe", { exact: true })
    .fill("  Glukoza  ");
  await page
    .getByRole("combobox", { name: /^Status narudžbe/ })
    .selectOption("IN_PROGRESS");
  await page.getByRole("combobox", { name: /^Hitnost/ }).selectOption("URGENT");
  await page.getByLabel("Naručeno od", { exact: true }).fill("2026-01-01");
  await page.getByLabel("Naručeno do", { exact: true }).fill("2026-01-31");
  await page.getByRole("button", { name: "Pretraži", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "EZ-LAB-STARI", exact: true }),
  ).toBeVisible();
  expect(calls.at(-1)).toMatchObject({
    mode: "LAB",
    page_number: 0,
    search_term: "Glukoza",
    status_filter: "IN_PROGRESS",
    priority_filter: "URGENT",
    date_from: "2026-01-01",
    date_to: "2026-01-31",
  });
  await page
    .getByRole("button", { name: "Poništi filtre", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "EZ-LAB-0-0", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Pretraži narudžbe", { exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: /^Status narudžbe/ }),
  ).toHaveValue("");
  await expect(page.getByRole("combobox", { name: /^Hitnost/ })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("Naručeno od", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Naručeno do", { exact: true })).toHaveValue("");
  expect(calls.at(-1)).toMatchObject({
    page_number: 0,
    search_term: "",
    status_filter: null,
    priority_filter: null,
    date_from: null,
    date_to: null,
  });
});

test("laboratory filters fit a mobile viewport and reject a reversed date range", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const calls = await laboratoryFixture(page);
  const before = calls.length;
  await page.getByLabel("Naručeno od", { exact: true }).fill("2026-01-31");
  await page.getByLabel("Naručeno do", { exact: true }).fill("2026-01-01");
  await page.getByRole("button", { name: "Pretraži", exact: true }).click();
  expect(
    await page
      .getByLabel("Naručeno do", { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.rangeUnderflow),
  ).toBe(true);
  expect(calls.length).toBe(before);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
