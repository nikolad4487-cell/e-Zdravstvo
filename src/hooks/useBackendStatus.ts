import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
type BackendStatus =
  "unconfigured" | "checking" | "ready" | "missing-schema" | "unavailable";
export function useBackendStatus() {
  const [status, setStatus] = useState<BackendStatus>(
    supabase ? "checking" : "unconfigured",
  );
  useEffect(() => {
    if (!supabase) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    void (async () => {
      try {
        // No patient data. Permission denied is expected for anonymous callers.
        const { error } = await supabase!
          .from("profiles")
          .select("id")
          .limit(0)
          .abortSignal(controller.signal);
        if (controller.signal.aborted) {
          setStatus("unavailable");
          return;
        }
        if (error && error.code !== "42501") {
          setStatus(
            error.code === "PGRST205" ? "missing-schema" : "unavailable",
          );
          return;
        }
        const version = await supabase!
          .rpc("application_schema_version", {})
          .abortSignal(controller.signal);
        if (controller.signal.aborted) return;
        setStatus(
          version.error
            ? version.error.code === "PGRST202"
              ? "missing-schema"
              : "unavailable"
            : typeof version.data === "number" && version.data >= 2026101104
              ? "ready"
              : "missing-schema",
        );
      } catch {
        if (!controller.signal.aborted) setStatus("unavailable");
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);
  return status;
}
