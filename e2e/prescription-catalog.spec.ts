import { expect, test } from "@playwright/test";
const medication = {
  id: "60000000-0000-4000-8000-000000008001",
  name: "Rojazol",
  active_ingredient: "mikonazol",
  strength: "",
  form: "",
  packaging: "gel oral. 2%, 1x40 g",
  route: "L",
  catalog_code: "A01AB09 211",
  catalog_list: "HZZO:DLL:DLL-1. dio",
  catalog_metadata: {
    family: "DLL",
    source_date: "2026-10-01",
    fields: { "R/RS": "R", "Doplata za orig. pakiranje": 0.92 },
    guidance: [],
  },
};
for (const mobile of [false, true])
  test(`issuing a prescription uses a searched package and retains it after search and review${mobile ? " on mobile" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let issued: { data: { items: { medication_id: string }[] } } | undefined;
    await page.route("**/src/lib/supabase.ts*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const supabase=null;export const configured=false;export function db(){return {rpc:async(name,args)=>(await fetch('/__prescription_fixture',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
      }),
    );
    await page.route("**/__prescription_fixture", async (route) => {
      const { name, args } = route.request().postDataJSON();
      let data;
      if (name === "clinical_context")
        data = { doctors: [], allergies: [], diagnoses: [], medications: [] };
      else if (name === "search_prescription_medications")
        data = args.search_term.toLowerCase().includes("none")
          ? []
          : [medication];
      else if (name === "issue_document") {
        issued = args;
        data = "60000000-0000-4000-8000-000000008002";
      } else throw Error("Unexpected fixture RPC " + name);
      await route.fulfill({ json: { data, error: null } });
    });
    await page.goto("/e2e/fixtures/prescription.html");
    await page
      .getByRole("searchbox", { name: "Traži lijek" })
      .fill("mikonazol");
    const picker = page.getByRole("combobox", { name: "Lijek i pakiranje *" });
    await picker.selectOption(medication.id);
    await expect(
      page.getByText("Doplata prema listi: 0,92 EUR po pakiranju."),
    ).toBeVisible();
    await page.getByRole("searchbox", { name: "Traži lijek" }).fill("none");
    await expect(
      page.getByText("Nema lijekova za unesenu pretragu."),
    ).toBeVisible();
    await expect(picker).toHaveValue(medication.id);
    await page.getByLabel("Doziranje").fill("Testno doziranje");
    await page.getByLabel("Način primjene").fill("Lokalno");
    await page.getByLabel("Trajanje terapije").fill("Testno trajanje");
    await page
      .getByRole("button", { name: "Pregledaj prije izdavanja" })
      .click();
    await expect(page.locator(".confirm-box").last()).toContainText(
      "Rojazol · gel oral. 2%, 1x40 g",
    );
    await page.getByRole("button", { name: "Natrag na uređivanje" }).click();
    await expect(picker).toHaveValue(medication.id);
    await page
      .getByRole("button", { name: "Pregledaj prije izdavanja" })
      .click();
    await page
      .getByRole("button", { name: "Potvrdi izdavanje", exact: true })
      .click();
    await expect(page.getByText("Recept izdan")).toBeVisible();
    expect(issued?.data.items[0].medication_id).toBe(medication.id);
    expect(issued?.data.items[0]).not.toHaveProperty("name");
  });
