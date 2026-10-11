import { expect, test, type Page } from "@playwright/test";
import { hzzoCatalogData } from "../scripts/lib/hzzo-catalog-import.mjs";
const { sources, lists } = await hzzoCatalogData();
async function fixture(page: Page) {
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const supabase=null;export const configured=false;export function db(){return {rpc:async(name,args)=>(await fetch('/__catalog_fixture',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
    }),
  );
  await page.route("**/__catalog_fixture", async (route) => {
    const { name, args } = route.request().postDataJSON();
    let data;
    if (name === "medical_code_catalogs")
      data = {
        sources: sources.map((s) => ({
          ...s,
          id: s.source_id,
          file_name: s.file,
          revision: s.source_date ?? "Datum nije potvrđen",
          expected_count: s.entry_count,
          imported_count: s.entry_count,
          metadata: s,
        })),
        lists: lists.map(({ entries, ...l }) => ({
          ...l,
          count: entries.length,
        })),
      };
    else if (name === "search_diagnosis_codes") data = [];
    else if (name === "medical_code_source")
      data = lists.find((l) => l.id === args.catalog_id);
    else if (name === "search_medical_codes") {
      const l = lists.find((l) => l.id === args.catalog_id);
      const term = args.search_term.toLocaleLowerCase("hr");
      data = l?.entries
        .filter((e) =>
          (e.code + " " + e.name + " " + e.description)
            .toLocaleLowerCase("hr")
            .includes(term),
        )
        .sort(
          (a, b) =>
            Number(b.code.toLowerCase() === term) -
              Number(a.code.toLowerCase() === term) ||
            a.code.localeCompare(b.code),
        )
        .slice(args.page_number * 50, args.page_number * 50 + 50)
        .map((e) => ({ ...e, list_id: l.id }));
    } else throw Error("Unexpected fixture RPC " + name);
    await route.fulfill({ json: { data, error: null } });
  });
  await page.goto("/e2e/fixtures/catalogs.html");
  await expect(
    page.getByRole("combobox", { name: "Šifrarnik", exact: true }),
  ).toBeVisible();
}
test("catalog browser shows latest procedure edition, retains its tariff and marks older independent namespaces", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("combobox", { name: "Šifrarnik", exact: true })
    .selectOption("HZZO:DTP-SKZZ");
  await expect(
    page.getByRole("region", { name: "Verzija šifrarnika" }),
  ).toContainText("5. 12. 2025.");
  await page.getByRole("searchbox", { name: "Šifra ili naziv" }).fill("SK001");
  await expect(
    page.getByRole("cell", { name: "SK001", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("cell")
    .filter({ hasText: "Prikaži podatke" })
    .locator("summary")
    .first()
    .click();
  await expect(
    page.getByRole("cell").filter({ hasText: "Cijena (EUR)" }).first(),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Šifrarnik", exact: true })
    .selectOption("HZZO:DTS-POSTUPCI");
  await expect(
    page.getByRole("region", { name: "Verzija šifrarnika" }),
  ).toContainText("Povijesna referenca");
});
test("mobile catalog browser preserves leading zeros and flags the ambiguous DZO filename", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page
    .getByRole("combobox", { name: "Šifrarnik", exact: true })
    .selectOption("HZZO:NASELJA");
  await page.getByRole("searchbox", { name: "Šifra ili naziv" }).fill("072150");
  await expect(
    page.getByRole("cell", { name: "072150", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Šifrarnik", exact: true })
    .selectOption("HZZO:DZO");
  await expect(
    page.getByRole("region", { name: "Verzija šifrarnika" }),
  ).toContainText("Datum izdanja nije potvrđen");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
