import { useEffect } from "react";
import { useAuth } from "./useAuth";
import { db } from "../lib/supabase";
export function useScheduleRefresh(refresh: () => void) {
  const { profile } = useAuth();
  useEffect(() => {
    if (!profile) return;
    const c = db()
      .channel("schedule-" + crypto.randomUUID())
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "schedule_events",
          filter: "user_id=eq." + profile.id,
        },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: "user_id=eq." + profile.id,
        },
        refresh,
      )
      .subscribe();
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => {
      void db().removeChannel(c);
      window.removeEventListener("focus", focus);
    };
  }, [profile?.id, refresh]);
}
