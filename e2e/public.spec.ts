import { expect, test } from "@playwright/test";

test("login, patient context and password visibility work", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/prijava");
  await expect(page.getByLabel("E-mail adresa", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Građani", exact: true }).click();
  await expect(
    page.getByText("Moje e-Zdravstvo — vaš osobni zdravstveni portal"),
  ).toBeVisible();
  const password = page.locator("#password");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "Prikaži lozinku" }).click();
  await expect(password).toHaveAttribute("type", "text");
  expect(errors).toEqual([]);
});

for (const route of [
  "/ordinacija",
  "/central",
  "/moje/karton",
  "/ustanove",
  "/laboratorij",
  "/ljekarna",
  "/skola",
]) {
  test(`anonymous users cannot open ${route}`, async ({ page }) => {
    await page.goto(route);
    await expect(page).toHaveURL(/\/prijava$/);
    await expect(
      page.getByLabel("E-mail adresa", { exact: true }),
    ).toBeVisible();
  });
}

test("password recovery and unknown routes remain accessible", async ({
  page,
}) => {
  await page.goto("/zaboravljena-lozinka");
  await expect(
    page.getByRole("heading", { name: "Zaboravljena lozinka?" }),
  ).toBeVisible();
  await page.goto("/nova-lozinka");
  await expect(
    page.getByText("Poveznica nije valjana ili je istekla.", { exact: false }),
  ).toBeVisible();
  await page.goto("/nepostojeca-stranica");
  await expect(
    page.getByRole("heading", { name: "Stranica nije pronađena." }),
  ).toBeVisible();
});
