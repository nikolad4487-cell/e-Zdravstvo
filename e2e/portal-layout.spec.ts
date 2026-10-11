import { expect, test, type Page } from "@playwright/test";
async function assertInsideViewport(page: Page, selector: string) {
  const size = page.viewportSize()!;
  await expect
    .poll(async () => {
      const rect = await page.locator(selector).boundingBox();
      return Boolean(
        rect &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= size.width + 1 &&
        rect.y + rect.height <= size.height + 1,
      );
    })
    .toBe(true);
}
for (const size of [
  { width: 1366, height: 768 },
  { width: 1024, height: 600 },
  { width: 1280, height: 400 },
])
  test(`sidebar options scroll independently and logout stays visible at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/e2e/fixtures/portal-layout.html");
    await expect(
      page.getByRole("button", { name: "Odjavi se", exact: true }),
    ).toBeVisible();
    await assertInsideViewport(page, ".logout");
    const scroll = page.getByRole("region", {
      name: "Izbornik radnog prostora",
    });
    expect(
      await scroll.evaluate((el) => el.scrollHeight > el.clientHeight),
    ).toBe(true);
    await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(
      page.getByRole("link", { name: "O razvojnoj verziji" }),
    ).toBeInViewport();
    await assertInsideViewport(page, ".logout");
    await page.locator(".portal-main").evaluate(() => window.scrollTo(0, 500));
    await assertInsideViewport(page, ".logout");
    await page.getByRole("button", { name: "Odjavi se", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Odjava potvrđena");
  });
test("all patient modules remain reachable through the scrollable sidebar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 600 });
  await page.goto("/e2e/fixtures/portal-layout.html?patient");
  const scroll = page.getByRole("region", { name: "Izbornik radnog prostora" });
  await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
  await expect(
    page.getByRole("link", { name: "Postavke", exact: true }),
  ).toBeInViewport();
  await assertInsideViewport(page, ".logout");
});
for (const size of [
  { width: 390, height: 844 },
  { width: 667, height: 375 },
])
  test(`mobile drawer keeps logout visible and closes after navigation at ${size.width}x${size.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto("/e2e/fixtures/portal-layout.html");
    await expect(page.locator(".sidebar")).not.toBeVisible();
    await page
      .getByRole("button", { name: "Otvori navigaciju", exact: true })
      .click();
    await assertInsideViewport(page, ".logout");
    const scroll = page.getByRole("region", {
      name: "Izbornik radnog prostora",
    });
    await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(
      page.getByRole("link", { name: "O razvojnoj verziji" }),
    ).toBeInViewport();
    await assertInsideViewport(page, ".logout");
    await scroll.evaluate((el) => (el.scrollTop = 0));
    await page.getByRole("link", { name: "Pacijenti", exact: true }).click();
    await expect(page.locator(".sidebar")).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: "Otvori navigaciju", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
  });
for (const width of [390, 1024, 1366])
  test(`chart tabs wrap and content has no horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/e2e/fixtures/portal-layout.html");
    const tabs = page.getByRole("navigation", { name: "Dijelovi kartona" });
    expect(await tabs.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    for (const button of await tabs.getByRole("button").all()) {
      const rect = await button.boundingBox();
      const bounds = await tabs.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(
        bounds!.x + bounds!.width + 1,
      );
    }
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
