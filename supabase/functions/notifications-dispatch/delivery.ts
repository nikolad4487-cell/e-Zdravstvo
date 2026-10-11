export const APPOINTMENT_SENDER = "e-Zdravstvo <narudzbe@e-zdravstvo.tech>";
interface AppointmentDetails {
  eventType?: "BOOKED" | "RESCHEDULED" | "CANCELLED";
  patientName?: string;
  startsAt: string;
  durationMinutes: number;
  institution?: string;
  hospital?: string;
  doctor?: string;
  specialist?: string;
  department?: string;
  kind?: string;
  priority?: boolean;
  location: string;
}
export interface EmailJob {
  id: string;
  email: string;
  portalAccess?: boolean;
  appointment?: AppointmentDetails;
  confirmation?: AppointmentDetails;
}
export interface EmailConfiguration {
  apiKey: string;
  from: string;
  applicationUrl: string;
}
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
export function renderNotification(job: EmailJob, applicationUrl: string) {
  const url = new URL(applicationUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("HTTPS application URL required");
  const details = job.appointment ?? job.confirmation;
  const event = details?.eventType ?? "BOOKED";
  const priority = details?.priority ?? Boolean(job.confirmation);
  const title = !details
    ? "Nova obavijest u e-Zdravstvu"
    : event === "CANCELLED"
      ? "Pregled je otkazan"
      : event === "RESCHEDULED"
        ? "Promjena termina pregleda"
        : priority
          ? "Potvrda prioritetnog pregleda"
          : "Potvrda zakazanog pregleda";
  const intro = !details
    ? "U vašem portalu dostupna je nova obavijest."
    : event === "CANCELLED"
      ? "Vaš je pregled otkazan. Za dogovor novog termina obratite se svojem liječniku."
      : event === "RESCHEDULED"
        ? "Termin vašeg pregleda je promijenjen. U nastavku su novi podaci za dolazak."
        : "Vaš je pregled uspješno zakazan. Podatke za dolazak pronaći ćete u nastavku.";
  const rows: [string, string][] = details
    ? [
        ["Pacijent", details.patientName || "Pacijent"],
        ["Zdravstvena ustanova", details.institution || details.hospital || ""],
        ["Liječnik", details.doctor || details.specialist || ""],
        ["Vrsta pregleda", details.kind || "Specijalistički pregled"],
        ...(details.department
          ? [["Odjel", details.department] as [string, string]]
          : []),
        ...(priority
          ? [["Prioritet", "PRIORITETNI pregled"] as [string, string]]
          : []),
        [
          "Datum",
          new Intl.DateTimeFormat("hr-HR", {
            timeZone: "Europe/Zagreb",
            dateStyle: "full",
          }).format(new Date(details.startsAt)),
        ],
        [
          "Vrijeme",
          new Intl.DateTimeFormat("hr-HR", {
            timeZone: "Europe/Zagreb",
            timeStyle: "short",
          }).format(new Date(details.startsAt)),
        ],
        ["Trajanje", `${details.durationMinutes} minuta`],
        ["Lokacija", details.location || "Lokaciju provjerite u portalu"],
      ]
    : [];
  // Only fixed portal paths; no recipient, subject or URL supplied by frontend.
  const link =
    url.origin +
    (!details
      ? "/moje/obavijesti"
      : job.appointment
        ? "/moje/termini"
        : "/moje/narudzbe");
  const portalAccess = job.portalAccess !== false;
  const footer = portalAccess
    ? "Detalje i upute provjerite prijavom u portal. Postavke e-mail obavijesti možete promijeniti u svojem računu."
    : "Za dodatne informacije ili promjenu termina obratite se svojem liječniku. Sačuvajte ovu poruku s podacima o pregledu.";
  const text = `${title}\n\n${intro}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}${portalAccess ? `\n\nOtvori portal: ${link}` : ""}\n\n${footer}`;
  const html = `<!doctype html><html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:12px">
<tr><td style="padding:24px;background:#0f766e;color:#ffffff;font-size:22px;font-weight:bold">e-Zdravstvo</td></tr>
<tr><td style="padding:24px"><h1 style="margin:0 0 16px;font-size:24px;line-height:1.3">${escapeHtml(title)}</h1>
<p style="font-size:16px;line-height:1.6">${escapeHtml(intro)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.map(([label, value]) => `<tr><td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-size:14px;line-height:1.6;overflow-wrap:anywhere"><span style="color:#475569">${escapeHtml(label)}</span><br><strong>${escapeHtml(value)}</strong></td></tr>`).join("")}</table>
${portalAccess ? `<p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#0f766e;color:white;padding:14px 22px;border-radius:6px;text-decoration:none;font-weight:bold">Otvori e-Zdravstvo</a></p>` : ""}
<p style="font-size:13px;line-height:1.6;color:#64748b">${escapeHtml(footer)}</p></td></tr></table>
<p style="font-size:12px;color:#64748b">Automatska obavijest sustava e-Zdravstvo.</p></td></tr></table></body></html>`;
  return { subject: `${title} — e-Zdravstvo`, text, html };
}
export async function deliverNotification(
  job: EmailJob,
  config: EmailConfiguration,
  request: typeof fetch = fetch,
) {
  if (config.from !== APPOINTMENT_SENDER)
    throw new Error("Unexpected notification sender");
  const content = renderNotification(job, config.applicationUrl);
  const response = await request("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `notification-${job.id}`,
    },
    body: JSON.stringify({
      from: APPOINTMENT_SENDER,
      to: [job.email],
      ...content,
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
    typeof data.id !== "string" ||
    !data.id
  )
    throw new Error("Invalid email provider response");
  return { succeeded: true, providerId: data.id, retrySeconds: 60 };
}
