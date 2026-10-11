export const APPOINTMENT_SENDER = "e-Zdravstvo <narudzbe@e-zdravstvo.tech>";
interface AppointmentDetails {
  eventType?: "BOOKED" | "RESCHEDULED" | "CANCELLED";
  patientName?: string;
  bookingReference?: string;
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
  const heading = !details
    ? "Nova obavijest u e-Zdravstvu"
    : event === "CANCELLED"
      ? "Vaš pregled je otkazan."
      : event === "RESCHEDULED"
        ? "Vaš termin pregleda je promijenjen."
        : "Vaš pregled je uspješno zakazan!";
  const intro = !details
    ? "U vašem portalu dostupna je nova obavijest."
    : event === "CANCELLED"
      ? "Obavještavamo Vas da je Vaš termin liječničkog pregleda otkazan. Za dogovor novog termina obratite se svojem liječniku."
      : event === "RESCHEDULED"
        ? "Obavještavamo Vas da je termin Vašeg liječničkog pregleda promijenjen. U nastavku su novi podaci za dolazak."
        : "Potvrđujemo da je Vaš termin liječničkog pregleda uspješno rezerviran.";
  const status =
    event === "CANCELLED"
      ? "Otkazano"
      : event === "RESCHEDULED"
        ? "Promijenjeno"
        : "Potvrđeno";
  const accent =
    event === "CANCELLED"
      ? "#f87171"
      : event === "RESCHEDULED"
        ? "#fbbf24"
        : "#34d399";
  const badgeBackground =
    event === "CANCELLED"
      ? "#361a1d"
      : event === "RESCHEDULED"
        ? "#342b15"
        : "#082b1b";
  const portalAccess = job.portalAccess !== false;
  const rows: [string, string][] = details
    ? [
        ["Pacijent", details.patientName || "Pacijent"],
        [
          "Datum i vrijeme",
          `${new Intl.DateTimeFormat("hr-HR", {
            timeZone: "Europe/Zagreb",
            day: "numeric",
            month: "long",
            year: "numeric",
          }).format(new Date(details.startsAt))} u ${new Intl.DateTimeFormat(
            "hr-HR",
            {
              timeZone: "Europe/Zagreb",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            },
          ).format(new Date(details.startsAt))}`,
        ],
        ["Zdravstvena ustanova", details.institution || details.hospital || ""],
        ["Liječnik", details.doctor || details.specialist || ""],
        ["Vrsta pregleda", details.kind || "Specijalistički pregled"],
        ...(details.department
          ? [["Odjel", details.department] as [string, string]]
          : []),
        ...(priority
          ? [["Prioritet", "PRIORITETNI pregled"] as [string, string]]
          : []),
        ["Trajanje", `${details.durationMinutes} minuta`],
        [
          "Lokacija",
          details.location ||
            (portalAccess
              ? "Lokaciju provjerite u portalu"
              : "Lokaciju provjerite kod svojeg liječnika"),
        ],
        ...(details.bookingReference
          ? [["Broj rezervacije", details.bookingReference] as [string, string]]
          : []),
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
  const instructions =
    details && event !== "CANCELLED"
      ? "Molimo Vas da na pregled dođete nekoliko minuta ranije."
      : "";
  const contact = portalAccess
    ? "Detalje i upute provjerite prijavom u portal. Postavke e-mail obavijesti možete promijeniti u svojem računu."
    : "Za dodatne informacije ili promjenu termina obratite se svojem liječniku. Sačuvajte ovu poruku s podacima o pregledu.";
  const footer =
    "Ova poruka poslana je automatski. Molimo ne odgovarajte na nju.";
  const text = `${heading}\n\nPoštovani/a,\n\n${intro}${details ? `\n\nStatus rezervacije: ${status}` : ""}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}${instructions ? `\n\n${instructions}` : ""}\n\nSrdačan pozdrav,\nTim e-Zdravstvo${portalAccess ? `\n\nOtvori portal: ${link}` : ""}\n\n${contact}\n\n${footer}`;
  const html = `<!doctype html><html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(title)}</title>
<style>@media only screen and (max-width:480px){.email-outer{padding:12px 8px!important}.email-body{padding:20px 16px!important}}</style></head>
<body bgcolor="#050607" style="margin:0;padding:0;background:#050607;font-family:Arial,Helvetica,sans-serif;color:#e5e7eb;color-scheme:dark">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#050607"><tr><td class="email-outer" align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#0b0d0f" style="max-width:640px;background:#0b0d0f;border:1px solid #292d32;border-radius:12px">
<tr><td class="email-body" style="padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td width="30" style="vertical-align:middle;color:#60a5fa;font-size:24px;line-height:1">&#9825;</td>
<td style="font-size:16px;line-height:1.5;color:#e5e7eb"><strong>e-Zdravstvo</strong><br><span style="font-size:14px;color:#aeb5bf">${details ? "Automatska potvrda termina" : "Automatska obavijest"}</span></td></tr></table>
<div style="margin-top:20px;border-top:1px solid #25292e"></div>
<h1 style="margin:24px 0 20px;font-size:18px;line-height:1.5;color:#f3f4f6"><span style="color:${accent}">${event === "CANCELLED" ? "&#8855;" : "&#10003;"}</span>&nbsp; ${escapeHtml(heading)}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6">Poštovani/a,</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6">${escapeHtml(intro)}</p>
${details ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:12px;border-bottom:1px solid #25292e;font-size:12px;color:#aeb5bf">Status rezervacije</td><td align="right" style="padding:12px;border-bottom:1px solid #25292e"><span style="display:inline-block;border-radius:16px;background:${badgeBackground};color:${accent};padding:5px 10px;font-size:12px;font-weight:bold">${status}</span></td></tr></table>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.map(([label, value]) => `<tr><td style="padding:10px 12px;font-size:16px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;color:#e5e7eb"><span style="font-size:12px;color:#aeb5bf">${escapeHtml(label)}</span><br><strong style="display:inline-block;padding-top:5px">${escapeHtml(value)}</strong></td></tr>`).join("")}</table>
${instructions ? `<p style="margin:24px 0 16px;font-size:16px;line-height:1.6">${escapeHtml(instructions)}</p>` : ""}
<p style="margin:20px 0;font-size:16px;line-height:1.6">Srdačan pozdrav,<br>Tim e-Zdravstvo</p>
${portalAccess ? `<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="color:#93c5fd;text-decoration:underline;font-size:14px">Otvori e-Zdravstvo</a></p>` : ""}
<p style="font-size:13px;line-height:1.6;color:#aeb5bf">${escapeHtml(contact)}</p>
<div style="margin:20px 0;border-top:1px solid #25292e"></div>
<p style="margin:0;font-size:13px;line-height:1.6;color:#aeb5bf">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
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
