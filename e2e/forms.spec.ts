import { expect, test } from "@playwright/test";
test("an edited modal survives a declined close and permits saving", async ({
  page,
}) => {
  await page.goto("/e2e/fixtures/modal.html");
  await page.getByLabel("Bilješka").fill("Testni tekst");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Zatvori", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByLabel("Bilješka")).toHaveValue("Testni tekst");
  await page.getByRole("button", { name: "Spremi", exact: true }).click();
  await expect(page.getByText("Obrazac zatvoren")).toBeVisible();
});
test("Escape requests consent before discarding an edited form", async ({
  page,
}) => {
  await page.goto("/e2e/fixtures/modal.html");
  await page.getByLabel("Bilješka").fill("Testni tekst");
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(page.getByText("Obrazac zatvoren")).toBeVisible();
});
test("login remains usable at a narrow mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/prijava");
  await expect(page.getByLabel("E-mail adresa", { exact: true })).toBeVisible();
  await page
    .getByLabel("E-mail adresa", { exact: true })
    .fill("fictional@example.test");
  await page.keyboard.press("Tab");
  await expect(page.locator("#password")).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
