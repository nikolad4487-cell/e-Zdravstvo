import { db } from "../lib/supabase";
/** Refresh factor metadata: another device may enroll MFA before this JWT refreshes. */
export async function sessionRequiresMfa() {
  const [assurance, factors] = await Promise.all([
    db().auth.mfa.getAuthenticatorAssuranceLevel(),
    db().auth.mfa.listFactors(),
  ]);
  if (assurance.error || factors.error)
    throw Error("Sigurnost prijave nije moguće provjeriti. Pokušajte ponovno.");
  return (
    assurance.data.currentLevel !== "aal2" &&
    factors.data.all.some((f) => f.status === "verified")
  );
}
