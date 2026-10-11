import { createClient } from "npm:@supabase/supabase-js@2.117.1";
import { deliverNotification } from "./delivery.ts";
const json = (status: number, body: object) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
async function matches(actual: string, expected: string) {
  const digest = async (value: string) =>
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    );
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}
Deno.serve(async (request) => {
  if (request.method !== "POST") return json(405, { error: "POST required" });
  const token = Deno.env.get("NOTIFICATIONS_JOB_TOKEN");
  if (!token) return json(503, { error: "Notification job is not configured" });
  if (
    !(await matches(
      request.headers.get("Authorization") ?? "",
      `Bearer ${token}`,
    ))
  )
    return json(401, { error: "Unauthorized" });
  const url = Deno.env.get("SUPABASE_URL"),
    key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json(503, { error: "Backend is not configured" });
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { error: reminderError } = await db.rpc(
    "generate_appointment_reminders",
  );
  if (reminderError) return json(500, { error: "Reminder generation failed" });
  const apiKey = Deno.env.get("RESEND_API_KEY"),
    from = Deno.env.get("NOTIFICATION_FROM_EMAIL"),
    applicationUrl = Deno.env.get("APPLICATION_URL");
  if (!apiKey || !from || !applicationUrl)
    return json(200, { remindersGenerated: true, emailAvailable: false });
  const { data: jobs, error } = await db.rpc("claim_notification_emails", {
    batch_size: 20,
  });
  if (error || !Array.isArray(jobs))
    return json(500, { error: "Email queue unavailable" });
  let sent = 0,
    failed = 0;
  for (const job of jobs) {
    let outcome = {
      succeeded: false,
      providerId: null as string | null,
      retrySeconds: 300,
    };
    try {
      outcome = await deliverNotification(job, {
        apiKey,
        from,
        applicationUrl,
      });
    } catch {
      /* Do not log recipients, tokens or provider response bodies. */
    }
    const { error: completionError } = await db.rpc(
      "complete_notification_email",
      {
        job_id: job.id,
        lease_id: job.lease_id,
        succeeded: outcome.succeeded,
        provider_id: outcome.providerId,
        retry_seconds: outcome.retrySeconds,
      },
    );
    if (outcome.succeeded && !completionError) sent++;
    else failed++;
  }
  return json(200, { processed: jobs.length, sent, failed });
});
