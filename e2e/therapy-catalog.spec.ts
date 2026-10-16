import { test, expect } from "@playwright/test";
test("therapy form searches the medicine catalog and stores the selected package identity", async ({
  page,
}) => {
  let issued: Record<string, unknown> | undefined;
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `export const supabase=null;export const configured=false;export function db(){return {rpc:async(name,args)=>(await fetch('/__therapy_fixture',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
    }),
  );
  await page.route("**/__therapy_fixture", async (route) => {
    const { name, args } = route.request().postDataJSON();
    let data: unknown;
    if (name === "clinical_context")
      data = { doctors: [], allergies: [], diagnoses: [], medications: [] };
    else if (name === "search_prescription_medications")
      data = [
        {
          id: "medicine-1",
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
            fields: { "R/RS": "R" },
            guidance: [],
          },
        },
      ];
    else if (name === "add_patient_therapy") {
      issued = args.data;
      data = "therapy-1";
    } else throw Error("Unexpected therapy fixture " + name);
    await route.fulfill({ json: { data, error: null } });
  });
  await page.goto("/e2e/fixtures/therapy.html");
  await page.getByRole("searchbox", { name: "Traži lijek" }).fill("mikonazol");
  await page
    .getByRole("combobox", { name: "Lijek i pakiranje *" })
    .selectOption("medicine-1");
  await page.getByLabel("Doziranje").fill("Testno doziranje");
  await page.getByLabel("Učestalost").fill("Testna učestalost");
  await page.getByRole("button", { name: "Spremi", exact: true }).click();
  await expect(page.getByText("Terapija spremljena")).toBeVisible();
  expect(issued?.medication_id).toBe("medicine-1");
});
