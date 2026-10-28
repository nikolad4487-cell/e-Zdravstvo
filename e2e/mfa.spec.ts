import { test, expect, type Page } from "@playwright/test";
async function fixture(page: Page, enroll = false) {
  const calls: { kind: string; args?: Record<string, unknown> }[] = [];
  let verified = !enroll,
    level = "aal1",
    exists = !enroll;
  await page.route("**/src/lib/supabase.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
 let callback;const session={access_token:'FICTIONAL_TEST_TOKEN',user:{id:'user-test'}};
 async function post(kind,args={}){return(await fetch('/__mfa_fixture',{method:'POST',body:JSON.stringify({kind,args})})).json();}
 const auth={onAuthStateChange(fn){callback=fn;queueMicrotask(()=>fn('INITIAL_SESSION',session));return{data:{subscription:{unsubscribe(){}}}};},mfa:{getAuthenticatorAssuranceLevel:()=>post('assurance'),listFactors:()=>post('factors'),enroll:args=>post('enroll',args),unenroll:args=>post('unenroll',args),async challengeAndVerify(args){const result=await post('verify',args);if(!result.error){session.access_token='FICTIONAL_AAL2_TOKEN';callback?.('MFA_CHALLENGE_VERIFIED',session);}return result;}},async signOut(){callback?.('SIGNED_OUT',null);return{error:null};}};
 const client={auth,rpc:(name,args)=>post(name,args),from(table){const chain={select(){return chain;},eq(){return chain;},order(){return chain;},single(){return chain;},then(resolve,reject){return post('table',{table}).then(resolve,reject);}};return chain;}};
 export const supabase=client;export const configured=true;export function db(){return client;}
 `,
    }),
  );
  await page.route("**/__mfa_fixture", async (route) => {
    const { kind, args } = route.request().postDataJSON();
    calls.push({ kind, args });
    let data: unknown,
      error: unknown = null;
    if (kind === "assurance")
      data = { currentLevel: level, nextLevel: verified ? "aal2" : "aal1" };
    else if (kind === "factors")
      data = {
        all: exists
          ? [
              {
                id: "factor-test",
                factor_type: "totp",
                friendly_name: "Testni telefon",
                status: verified ? "verified" : "unverified",
              },
            ]
          : [],
      };
    else if (kind === "table")
      data =
        args.table === "profiles"
          ? {
              id: "user-test",
              first_name: "Testni",
              last_name: "Korisnik",
              must_change_password: false,
            }
          : args.table === "user_roles"
            ? [{ role: "DOCTOR" }]
            : [];
    else if (kind === "verify") {
      if (args.code !== "000000")
        error = { message: "Fictional invalid test code" };
      else {
        verified = true;
        level = "aal2";
        data = { session: { access_token: "FICTIONAL_AAL2_TOKEN" } };
      }
    } else if (kind === "enroll") {
      exists = true;
      data = {
        id: "factor-test",
        type: "totp",
        totp: {
          qr_code:
            'data:image/svg+xml;utf-8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>',
          secret: "FICTIONAL_TEST_SECRET",
        },
      };
    } else if (kind === "unenroll") {
      exists = false;
      verified = false;
      data = { id: "factor-test" };
    } else if (kind === "record_session_event") data = null;
    else throw Error("Unexpected MFA fixture " + kind);
    await route.fulfill({ json: { data, error } });
  });
  await page.goto("/e2e/fixtures/mfa.html" + (enroll ? "?enroll=1" : ""));
  return calls;
}
test("verified MFA requires a code before account metadata loads", async ({
  page,
}) => {
  const calls = await fixture(page);
  await expect(
    page.getByRole("heading", { name: "Potvrda prijave" }),
  ).toBeVisible();
  expect(calls.some((c) => c.kind === "table")).toBe(false);
  await page
    .getByLabel("Šesteroznamenkasti kod iz autentifikatora")
    .fill("123456");
  await page
    .getByRole("button", { name: "Potvrdi prijavu", exact: true })
    .click();
  await expect(
    page.getByText(
      "Kod nije prihvaćen. Unesite trenutačni kod iz autentifikatora.",
    ),
  ).toBeVisible();
  expect(calls.some((c) => c.kind === "table")).toBe(false);
  await page
    .getByLabel("Šesteroznamenkasti kod iz autentifikatora")
    .fill("000000");
  await page
    .getByRole("button", { name: "Potvrdi prijavu", exact: true })
    .click();
  await expect(page.getByRole("status")).toHaveText("Prijava potvrđena.");
  expect(calls.some((c) => c.kind === "table")).toBe(true);
});
test("TOTP enrollment verifies the factor and supports secure removal on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls = await fixture(page, true);
  await expect(page.getByText("Drugi faktor još nije uključen.")).toBeVisible();
  await page.getByLabel("Naziv autentifikatora").fill("Testni telefon");
  await page.getByRole("button", { name: "Dodaj autentifikator" }).click();
  await expect(
    page.getByRole("img", {
      name: "QR kod za povezivanje vašeg autentifikatora",
    }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByRole("img", {
          name: "QR kod za povezivanje vašeg autentifikatora",
        })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page
    .getByLabel("Šesteroznamenkasti kod iz autentifikatora")
    .fill("000000");
  await page.getByRole("button", { name: "Potvrdi aktivaciju" }).click();
  await expect(page.getByText("Aktivan", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "QR kod za povezivanje vašeg autentifikatora",
    }),
  ).toBeHidden();
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Ukloni autentifikator" }).click();
  await expect(page.getByText("Drugi faktor još nije uključen.")).toBeVisible();
  expect(calls.some((c) => c.kind === "unenroll")).toBe(true);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
