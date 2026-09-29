import { db } from "../lib/supabase";
import { z } from "zod";
export async function createAdminAccount(input: {
  email: string;
  first_name: string;
  last_name: string;
  password: string;
  is_demo: boolean;
  request_id: string;
}) {
  const session = await db().auth.getSession();
  if (session.error || !session.data.session)
    throw new Error("Prijavite se ponovno.");
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-accounts`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + session.data.session.access_token,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
      cache: "no-store",
    },
  );
  const body: unknown = await response.json();
  if (!response.ok)
    throw new Error(
      z.object({ error: z.string() }).safeParse(body).data?.error ??
        "Otvaranje računa nije uspjelo.",
    );
  return z.object({ id: z.string(), email: z.string() }).parse(body);
}
import { unwrap } from "./clinical";
import {
  adminConfigurationSchema,
  adminUsersSchema,
  centralOverviewSchema,
} from "../types/admin";
export async function getAdminConfiguration() {
  return adminConfigurationSchema.parse(
    unwrap(await db().rpc("admin_configuration", {})),
  );
}
export async function getAdminUsers(search: string, page: number) {
  return adminUsersSchema.parse(
    unwrap(
      await db().rpc("admin_users", { search_term: search, page_number: page }),
    ),
  );
}
export async function getCentralOverview() {
  return centralOverviewSchema.parse(
    unwrap(await db().rpc("central_overview", {})),
  );
}
