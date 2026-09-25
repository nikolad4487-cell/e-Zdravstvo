import { db } from "../lib/supabase";
export async function loadAccount(id: string) {
  const [profile, roles, institutions] = await Promise.all([
    db().from("profiles").select("*").eq("id", id).single(),
    db().from("user_roles").select("*").eq("user_id", id),
    db().from("institutions").select("*").order("name"),
  ]);
  if (profile.error || roles.error || institutions.error)
    throw new Error(
      "Podaci računa nisu dostupni. Provjerite vezu i primijenjene migracije.",
    );
  return {
    profile: profile.data,
    assignments: roles.data,
    institutions: institutions.data,
  };
}
export async function sessionEvent(event: "LOGIN_SUCCESS" | "LOGOUT") {
  const { error } = await db().rpc("record_session_event", { event });
  if (error) throw new Error("Sigurnosni događaj nije moguće evidentirati.");
}
