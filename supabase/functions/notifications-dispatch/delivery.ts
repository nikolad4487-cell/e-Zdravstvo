export interface EmailJob {
  id: string;
  email: string;
}
export interface EmailConfiguration {
  apiKey: string;
  from: string;
  applicationUrl: string;
}
export async function deliverNotification(
  job: EmailJob,
  config: EmailConfiguration,
  request: typeof fetch = fetch,
) {
  const url = new URL(config.applicationUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("HTTPS application URL required");
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `notification-${job.id}`,
    },
    body: JSON.stringify({
      from: config.from,
      to: [job.email],
      subject: "Nova obavijest u e-Zdravstvu",
      text: `U e-Zdravstvu imate novu obavijest. Prijavite se u svoj portal: ${url.origin}/moje/obavijesti\n\nOva poruka ne sadrži medicinske podatke. Postavke obavijesti možete promijeniti u portalu.`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const header = Number(response.headers.get("retry-after"));
    return {
      succeeded: false,
      providerId: null,
      retrySeconds:
        Number.isFinite(header) && header > 0
          ? Math.min(Math.ceil(header), 3600)
          : 300,
    };
  }
  const data: unknown = await response.json();
  if (
    !data ||
    typeof data !== "object" ||
    !("id" in data) ||
    typeof data.id !== "string"
  )
    throw new Error("Invalid email provider response");
  return { succeeded: true, providerId: data.id, retrySeconds: 60 };
}
