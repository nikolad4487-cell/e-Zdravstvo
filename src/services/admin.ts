import { db } from "../lib/supabase";
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
