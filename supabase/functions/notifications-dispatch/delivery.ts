export interface EmailJob {
  id: string;
  email: string;
  confirmation?: {
    startsAt: string;
    durationMinutes: number;
    hospital: string;
    department: string;
    specialist: string;
    location: string;
  };
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
  const confirmation = job.confirmation;
  const text = confirmation
    ? `Potvrđen je vaš PRIORITETNI pregled.\n\nDatum i vrijeme: ${new Intl.DateTimeFormat("hr-HR", { timeZone: "Europe/Zagreb", dateStyle: "full", timeStyle: "short" }).format(new Date(confirmation.startsAt))}\nTrajanje: ${confirmation.durationMinutes} minuta\nBolnica: ${confirmation.hospital}\nOdjel: ${confirmation.department}\nSpecijalist: ${confirmation.specialist}\nLokacija: ${confirmation.location}\n\nNarudžbu i upute za dolazak provjerite u portalu: ${url.origin}/moje/narudzbe\n\nPoruka ne sadrži dijagnozu ni sadržaj uputnice. Postavke obavijesti možete promijeniti u portalu.`
    : `U e-Zdravstvu imate novu obavijest. Prijavite se u svoj portal: ${url.origin}/moje/obavijesti\n\nOva poruka ne sadrži medicinske podatke. Postavke obavijesti možete promijeniti u portalu.`;
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
      subject: confirmation
        ? "Potvrda prioritetnog pregleda — e-Zdravstvo"
        : "Nova obavijest u e-Zdravstvu",
      text,
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
