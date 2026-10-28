import { test, expect } from "@playwright/test";
for (const mobile of [false, true])
  test(`sample scan, rejection, replacement and label PDF${mobile ? " on mobile" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const samples = [
      {
        id: "sample-1",
        code: "EZ-UZ-2026-00000001",
        specimen_code: "00",
        specimen_name: "Kapilarna krv",
        collection_round: 1,
        status: "REGISTERED",
        reason: "",
        version: 1,
        replaced: false,
        created_at: "2026-10-28T08:00:00Z",
        history: [],
      },
    ];
    const order = {
      number: "EZ-LAB-TEST",
      patient_name: "Testna Osoba",
      patient_number: "EZ-PAC-TEST",
      status: "ORDERED",
      sample_status: "ARRIVED",
      attempt: 0,
    };
    await page.route("**/src/lib/supabase.ts*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const supabase=null;export const configured=false;export function db(){return{rpc:async(name,args)=>(await fetch('/__samples',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
      }),
    );
    await page.route("**/__samples", async (route) => {
      const { name, args } = route.request().postDataJSON();
      calls.push({ name, args });
      let data: unknown;
      if (name === "list_laboratory_samples")
        data = {
          order,
          items: samples.filter(
            (s) => !args.sample_code || s.code === args.sample_code,
          ),
        };
      else if (name === "search_medical_codes")
        data = [
          {
            list_id: "2.2.18",
            code: "00",
            name: "Kapilarna krv",
            description: "Testna vrsta uzorka",
          },
        ];
      else if (name === "change_laboratory_sample") {
        const s = samples.find((s) => s.id === args.sample_id)!;
        expect(args.expected_version).toBe(s.version);
        s.status = args.new_status;
        s.reason = args.reason;
        s.version++;
        data = null;
      } else if (name === "create_laboratory_sample") {
        expect(args).toMatchObject({
          order_id: "order-test",
          specimen_code: "00",
          replaces_sample_id: "sample-1",
        });
        samples[0].replaced = true;
        samples.push({
          ...samples[0],
          id: "sample-2",
          code: "EZ-UZ-2026-00000002",
          status: "REGISTERED",
          version: 1,
          replaced: false,
          reason: "",
        });
        data = "sample-2";
      } else if (name === "laboratory_sample_label") {
        data = { order, items: samples.filter((s) => s.id === args.sample_id) };
      } else throw Error("Unexpected samples RPC " + name);
      await route.fulfill({ json: { data, error: null } });
    });
    await page.goto("/e2e/fixtures/laboratory-samples.html");
    await page
      .getByLabel("Skeniraj ili upiši oznaku uzorka")
      .fill("DRUGI-UZORAK");
    await page.getByRole("button", { name: "Pronađi oznaku" }).click();
    await expect(
      page.getByText(
        "Oznaka nije pronađena u ovom zahtjevu. Provjerite pacijenta i oznaku.",
      ),
    ).toBeVisible();
    await page.getByRole("button", { name: "Prikaži sve uzorke" }).click();
    await page
      .getByRole("button", { name: "Zaprimi uzorak", exact: true })
      .click();
    await expect(
      page.locator(".sample-stage").filter({ hasText: "Uzorak zaprimljen" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Odbij uzorak", exact: true })
      .click();
    await page
      .getByLabel("Razlog odbijanja uzorka")
      .fill("Neispravan testni uzorak");
    await page.getByRole("button", { name: "Potvrdi odbijanje" }).click();
    await expect(
      page.getByRole("button", { name: "PDF oznaka" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Izradi zamjensku oznaku" }).click();
    await page
      .getByRole("button", { name: "Izradi oznaku", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "EZ-UZ-2026-00000002", exact: true }),
    ).toBeVisible();
    const card = page
      .locator("section.card")
      .filter({
        has: page.getByRole("heading", {
          name: "EZ-UZ-2026-00000002",
          exact: true,
        }),
      });
    const downloaded = page.waitForEvent("download");
    await card.getByRole("button", { name: "PDF oznaka" }).click();
    const download = await downloaded;
    expect(download.suggestedFilename()).toBe("EZ-UZ-2026-00000002.pdf");
    expect(
      calls.some(
        (c) =>
          c.name === "laboratory_sample_label" &&
          c.args.sample_id === "sample-2",
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/laboratory-samples-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
  });
