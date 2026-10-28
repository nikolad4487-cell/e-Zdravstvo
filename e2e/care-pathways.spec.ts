import { test, expect } from "@playwright/test";
for (const mobile of [false, true])
  test(`care review and follow-up${mobile ? " on mobile" : ""}`, async ({
    page,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    let reviewed = false,
      followup = false,
      done = false;
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const base = {
      source_kind: "MEDICAL_REPORT",
      source_id: "report-1",
      patient_id: "patient-1",
      patient_name: "Testna Osoba",
      patient_number: "EZ-PAC-TEST",
      title: "EZ-NAL-TEST",
      detail: "Izmišljeni laboratorij",
      event_at: "2026-10-28T08:00:00Z",
      due_on: null,
      stage: "NEEDS_REVIEW",
      result_kind: "MEDICAL_REPORT",
      result_id: "report-1",
      version: 1,
      referral_id: null,
    };
    await page.route("**/src/lib/supabase.ts*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: `export const supabase=null;export const configured=false;export function db(){return{rpc:async(name,args)=>(await fetch('/__care_fixture',{method:'POST',body:JSON.stringify({name,args})})).json()};}`,
      }),
    );
    await page.route("**/__care_fixture", async (route) => {
      const { name, args } = route.request().postDataJSON();
      calls.push({ name, args });
      let data: unknown;
      if (name === "care_pathways") {
        const items = [];
        if (!reviewed || args.include_closed)
          items.push({
            ...base,
            stage: reviewed ? "REVIEWED" : "NEEDS_REVIEW",
          });
        if (followup && (!done || args.include_closed))
          items.push({
            ...base,
            source_kind: "FOLLOWUP",
            source_id: "followup-1",
            title: "Kontrola testnog nalaza",
            due_on: "2026-11-01",
            stage: done ? "CLOSED" : "FOLLOWUP_PLANNED",
            result_kind: null,
            result_id: null,
          });
        data = { total: items.length, counts: {}, items };
      } else if (name === "review_care_result") {
        expect(args).toEqual({
          result_kind: "MEDICAL_REPORT",
          result_id: "report-1",
        });
        reviewed = true;
        data = "review-1";
      } else if (name === "create_care_followup") {
        expect(args.patient_id).toBe("patient-1");
        expect(args).toMatchObject({
          source_kind: "MEDICAL_REPORT",
          source_id: "report-1",
        });
        expect(args.title).toBe("Kontrola testnog nalaza");
        followup = true;
        data = "followup-1";
      } else if (name === "resolve_care_followup") {
        expect(args).toMatchObject({
          followup_id: "followup-1",
          expected_version: 1,
          new_status: "DONE",
        });
        done = true;
        data = null;
      } else throw Error("Unexpected care RPC " + name);
      await route.fulfill({ json: { data, error: null } });
    });
    await page.goto("/e2e/fixtures/care-pathways.html");
    await page.getByRole("button", { name: "Dodaj kontrolnu obvezu" }).click();
    await page
      .getByLabel("Opis kontrolne obveze")
      .fill("Kontrola testnog nalaza");
    const due = page.getByLabel(/Rok kontrole/);
    await due.fill((await due.getAttribute("min"))!);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Spremi", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Kontrola testnog nalaza" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Potvrdi pregled nalaza" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Spremi", exact: true }).click();
    expect(calls.some((c) => c.name === "review_care_result")).toBe(false);
    await dialog.getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Spremi", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "EZ-NAL-TEST", exact: true }),
    ).toBeHidden();
    await page.getByRole("button", { name: "Zaključi obvezu" }).click();
    await page.getByLabel("Obrazloženje").fill("Testna kontrola obavljena");
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Spremi", exact: true })
      .click();
    await expect(
      page.getByText("Nema stavki za odabrane filtre."),
    ).toBeVisible();
    await page
      .getByRole("checkbox", {
        name: "Prikaži i pregledane / zaključene stavke",
      })
      .check();
    await expect(
      page.locator(".sample-stage").filter({ hasText: /^Nalaz pregledan$/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `/tmp/care-pathways-${mobile ? "mobile" : "desktop"}.png`,
      fullPage: true,
    });
  });
