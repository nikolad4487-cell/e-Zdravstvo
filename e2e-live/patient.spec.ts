import { test, expect } from "@playwright/test";
test("patient signs in, opens new modules and remains outside staff portals", async ({
  page,
}) => {
  if (!process.env.E2E_PATIENT_EMAIL || !process.env.E2E_PATIENT_PASSWORD)
    throw new Error(
      "Run test:backend:local first on disposable local Supabase.",
    );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/prijava");
  await page
    .getByLabel("E-mail adresa", { exact: true })
    .fill(process.env.E2E_PATIENT_EMAIL);
  await page.locator("#password").fill(process.env.E2E_PATIENT_PASSWORD);
  await page.getByRole("button", { name: "Prijavi se", exact: true }).click();
  await expect(page).toHaveURL(/\/moje$/);
  await page.goto("/moje/zahtjevi-za-termin");
  await expect(
    page.getByRole("heading", {
      name: "Zahtjevi za termin u ordinaciji",
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/moje/skrbnistvo");
  await expect(
    page.getByRole("heading", { name: "Djeca pod skrbništvom" }),
  ).toBeVisible();
  await page.goto("/moje/lijekovi");
  await expect(
    page.getByRole("heading", { name: "Lijekovi", exact: true }),
  ).toBeVisible();
  await page.goto("/ordinacija");
  await expect(page).not.toHaveURL(/\/ordinacija$/);
  expect(errors).toEqual([]);
});
