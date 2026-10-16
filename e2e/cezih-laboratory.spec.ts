import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
const lists = JSON.parse(
  await readFile("data/medical-catalogs/cezih.json", "utf8"),
) as {
  id: string;
  entries: { code: string; name: string; description: string; page: number }[];
}[];
async function fixture(page: Page, mode = "CARE") {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const supabase=null;export const configured=false;export function db(){return {rpc:async(name,args)=>(await fetch('/__cezih_lab_fixture',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
    }),
  );
  await page.route("**/__cezih_lab_fixture", async (route) => {
    const { name, args } = route.request().postDataJSON();
    calls.push({ name, args });
    let data: unknown;
    if (name === "search_laboratory")
      data =
        mode === "LAB"
          ? [
              {
                id: "order-1",
                number: "TEST-LAB-1",
                patient_id: "fictional-patient",
                patient_name: "Testna Osoba",
                patient_number: "TEST-1",
                birth_date: "2000-01-01",
                doctor_name: "dr. Test",
                laboratory_name: "Testni laboratorij",
                requested_tests: "TSH",
                clinical_question: "",
                priority: "REGULAR",
                status: "IN_PROGRESS",
                version: 2,
                created_at: "2026-10-16T08:00:00Z",
                cancellation_reason: null,
                can_publish: true,
                can_cancel: false,
                results: [],
              },
            ]
          : [];
    else if (name === "laboratory_trend_catalog") data = [];
    else if (name === "laboratory_context")
      data = [{ id: "lab-1", name: "Testni laboratorij" }];
    else if (name === "search_medical_codes")
      data = lists
        .find((l) => l.id === args.catalog_id)
        ?.entries.filter((e) =>
          (e.code + " " + e.description)
            .toLowerCase()
            .includes(args.search_term.toLowerCase()),
        )
        .slice(args.page_number * 50, args.page_number * 50 + 50)
        .map((e) => ({ ...e, list_id: args.catalog_id }));
    else if (
      name === "order_laboratory" ||
      name === "publish_laboratory_result"
    )
      data = "result-1";
    else throw Error("Unexpected CEZIH laboratory fixture " + name);
    await route.fulfill({ json: { data, error: null } });
  });
  await page.goto("/e2e/fixtures/cezih-laboratory.html?mode=" + mode);
  return calls;
}
test("orders use actual CEZIH order codes and preserve specimen code 00", async ({
  page,
}) => {
  const calls = await fixture(page);
  await page
    .getByRole("button", { name: "Nova laboratorijska narudžba", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: /^Laboratorij/ })
    .selectOption("lab-1");
  await page
    .getByRole("listbox", { name: "Pretrage za naručivanje (CEZIH)" })
    .selectOption(["28090-10", "35510-10"]);
  await page
    .getByRole("listbox", { name: "Vrste uzoraka (CEZIH)" })
    .selectOption(["00", "07"]);
  await page.getByRole("button", { name: "Pošalji u laboratorij" }).click();
  await expect
    .poll(() => calls.find((c) => c.name === "order_laboratory"))
    .toBeTruthy();
  const data = calls.find((c) => c.name === "order_laboratory")?.args.data as {
    catalog_order_codes: string[];
    specimen_codes: string[];
  };
  expect(data.catalog_order_codes).toEqual(["28090-10", "35510-10"]);
  expect(data.specimen_codes).toEqual(["00", "07"]);
});
test("results search all 113 codes and support a textual finding", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await fixture(page, "LAB");
  await page
    .getByRole("button", { name: "Unesi rezultate", exact: true })
    .click();
  await page
    .getByRole("searchbox", { name: "Traži: Parametar iz CEZIH šifrarnika" })
    .fill("1-2159010");
  await page
    .getByRole("combobox", { name: "Parametar iz CEZIH šifrarnika" })
    .selectOption("1-2159010");
  await page
    .getByRole("combobox", { name: "Vrsta vrijednosti" })
    .selectOption("TEXT");
  await page.getByLabel("Tekst rezultata").fill("Testna kvalitativna napomena");
  await page.getByRole("button", { name: "Pregledaj prije objave" }).click();
  await page.getByRole("button", { name: "Potvrdi objavu" }).click();
  await expect
    .poll(() => calls.find((c) => c.name === "publish_laboratory_result"))
    .toBeTruthy();
  const data = calls.find((c) => c.name === "publish_laboratory_result")?.args
    .data as {
    parameters: {
      catalog_list: string;
      code: string;
      value_kind: string;
      text_value: string;
    }[];
  };
  expect(data.parameters[0]).toMatchObject({
    catalog_list: "2.2.31",
    code: "1-2159010",
    value_kind: "TEXT",
    text_value: "Testna kvalitativna napomena",
  });
});
