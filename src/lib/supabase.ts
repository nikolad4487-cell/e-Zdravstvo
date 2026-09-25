import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const configured = Boolean(
  url && /^https?:\/\//.test(url) && key && !key.startsWith("replace-"),
);
// Only authentication tokens use browser storage. Never persist clinical data.
const authStorage = {
  getItem: (name: string) =>
    sessionStorage.getItem(name) ?? localStorage.getItem(name),
  setItem: (name: string, value: string) => {
    const target =
      localStorage.getItem("ez-remember") === "true"
        ? localStorage
        : sessionStorage;
    const other = target === localStorage ? sessionStorage : localStorage;
    other.removeItem(name);
    target.setItem(name, value);
  },
  removeItem: (name: string) => {
    sessionStorage.removeItem(name);
    localStorage.removeItem(name);
  },
};
export const supabase = configured
  ? createClient<Database>(url!, key!, {
      auth: {
        storage: authStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;
export function db() {
  if (!supabase) throw new Error("Supabase nije konfiguriran.");
  return supabase;
}
