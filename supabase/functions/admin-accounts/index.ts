import { createClient } from "npm:@supabase/supabase-js@2.117.1";
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" },
  });
}
type Job = {
  id: string;
  actor_id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_demo: boolean;
  user_id: string | null;
};
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST")
    return reply({ error: "Metoda nije podržana." }, 405);
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer "))
      return reply({ error: "Prijavite se ponovno." }, 401);
    const url = Deno.env.get("SUPABASE_URL")!,
      anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const identity = await caller.auth.getUser();
    if (identity.error || !identity.data.user)
      return reply({ error: "Prijavite se ponovno." }, 401);
    const reader = request.body?.getReader();
    if (!reader) return reply({ error: "Nedostaju podaci." }, 400);
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > 16384) {
        await reader.cancel();
        return reply({ error: "Prevelik zahtjev." }, 413);
      }
      chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, at);
      at += chunk.length;
    }
    const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!body || typeof body !== "object")
      return reply({ error: "Neispravan zahtjev." }, 400);
    const input = body as Record<string, unknown>;
    const password = input.password;
    if (
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      return reply(
        { error: "Početna lozinka mora imati od 12 do 128 znakova." },
        400,
      );
    if (
      typeof input.email !== "string" ||
      typeof input.first_name !== "string" ||
      typeof input.last_name !== "string" ||
      typeof input.request_id !== "string" ||
      typeof input.is_demo !== "boolean"
    )
      return reply({ error: "Nedostaju podaci računa." }, 400);
    const start = await caller.rpc("begin_account_provision", {
      request_id: input.request_id,
      email: input.email.trim(),
      first_name: input.first_name,
      last_name: input.last_name,
      demo_account: input.is_demo,
    });
    if (start.error)
      return reply(
        {
          error:
            start.error.code === "42501"
              ? "Samo administrator sustava može otvarati račune."
              : "Zahtjev nije prihvaćen. Provjerite podatke i broj nedavno otvorenih računa.",
        },
        start.error.code === "42501" ? 403 : 400,
      );
    const job = start.data as Job;
    let userId = job.user_id;
    if (!userId) {
      const service = createClient(
        url,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const created = await service.auth.admin.createUser({
        email: job.email,
        password,
        email_confirm: true,
        user_metadata: { first_name: job.first_name, last_name: job.last_name },
        app_metadata: {
          admin_provisioned: true,
          is_demo: job.is_demo,
          provision_request_id: job.id,
          provision_actor_id: job.actor_id,
        },
      });
      if (created.error || !created.data.user)
        return reply(
          {
            error:
              "Račun nije otvoren. Provjerite postoji li već račun s tim e-mailom. Postojeći računi se ne mijenjaju.",
          },
          409,
        );
      userId = created.data.user.id;
    }
    const done = await caller.rpc("finish_account_provision", {
      provision_id: job.id,
      target_user: userId,
    });
    if (done.error)
      return reply(
        {
          error:
            "Račun je otvoren bez ovlasti, ali evidencija još nije dovršena. Ponovite isti zahtjev.",
        },
        503,
      );
    return reply({ id: userId, email: job.email });
  } catch {
    return reply(
      { error: "Otvaranje računa nije uspjelo. Pokušajte ponovno." },
      400,
    );
  }
});
