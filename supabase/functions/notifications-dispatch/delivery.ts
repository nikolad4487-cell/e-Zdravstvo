import {
  bookingPdf,
  bytesToBase64,
  type BookingPdfDetails,
} from "./booking-pdf.ts";
import { documentPdf, type DocumentEmailDetails } from "./document-pdf.ts";
export const APPOINTMENT_SENDER = "e-Zdravstvo <narudzbe@e-zdravstvo.tech>";
export interface EmailJob {
  id: string;
  email: string;
  portalAccess?: boolean;
  appointment?: BookingPdfDetails;
  confirmation?: BookingPdfDetails;
  document?: DocumentEmailDetails;
}
export interface EmailConfiguration {
  apiKey: string;
  from: string;
  applicationUrl: string;
}
// Fixed diagnostic codes only; never return provider messages or patient data.
export type DeliveryFailureCode =
  | "RESEND_DOMAIN_NOT_VERIFIED"
  | "RESEND_AUTHENTICATION_FAILED"
  | "RESEND_ACCESS_DENIED"
  | "RESEND_RATE_LIMITED"
  | "RESEND_REJECTED";
export interface DeliveryOutcome {
  succeeded: boolean;
  providerId: string | null;
  retrySeconds: number;
  failureCode?: DeliveryFailureCode;
  providerStatus?: number;
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
  if (job.document) {
    const text =
      "Poštovani/a,\n\nu privitku ove poruke dostavljamo Vaš izdani dokument u PDF obliku. Za pitanja o dokumentu obratite se liječniku ili ustanovi koja ga je izdala.\n\nSrdačan pozdrav,\nTim e-Zdravstvo\n\nOva poruka poslana je automatski. Molimo ne odgovarajte na nju.";
    // No patient identifiers, diagnoses, report text or document title in the body/subject.
    const html = `<!doctype html><html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#f5f7fa;font-family:Arial,sans-serif;color:#1f2937"><table role="presentation" width="100%"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="100%" style="max-width:640px;background:#ffffff;border:1px solid #dce2e8;border-radius:12px"><tr><td style="padding:24px;font-size:16px;line-height:1.6"><h1 style="font-size:20px;color:#087f8c">e-Zdravstvo</h1>${text
      .split("\n\n")
      .map((p) => `<p>${escapeHtml(p).replaceAll("\n", "<br>")}</p>`)
      .join("")}</td></tr></table></td></tr></table></body></html>`;
    return { subject: "Vaš dokument u PDF privitku — e-Zdravstvo", text, html };
  }
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
  const attachmentNotice = details
    ? event === "CANCELLED"
      ? "U privitku je PDF potvrda otkazivanja narudžbe."
      : "U privitku je PDF potvrda narudžbe s podacima o pacijentu i terminu pregleda."
    : "";
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
      ? "#b42318"
      : event === "RESCHEDULED"
        ? "#946200"
        : "#087443";
  const badgeBackground =
    event === "CANCELLED"
      ? "#fef3f2"
      : event === "RESCHEDULED"
        ? "#fff8e6"
        : "#e8f5ee";
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
  const text = `${heading}\n\nPoštovani/a,\n\n${intro}${attachmentNotice ? `\n\n${attachmentNotice}` : ""}${details ? `\n\nStatus rezervacije: ${status}` : ""}\n\n${rows.map(([label, value]) => `${label}: ${value}`).join("\n")}${instructions ? `\n\n${instructions}` : ""}\n\nSrdačan pozdrav,\nTim e-Zdravstvo${portalAccess ? `\n\nOtvori portal: ${link}` : ""}\n\n${contact}\n\n${footer}`;
  const html = `<!doctype html><html lang="hr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeHtml(title)}</title>
<style>@media only screen and (max-width:480px){.email-outer{padding:12px 8px!important}.email-body{padding:20px 16px!important}}</style></head>
<body bgcolor="#f5f7fa" style="margin:0;padding:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#1f2937;color-scheme:light">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f5f7fa"><tr><td class="email-outer" align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="max-width:640px;background:#ffffff;border:1px solid #dce2e8;border-radius:12px">
<tr><td class="email-body" style="padding:24px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
<td width="30" style="vertical-align:middle;color:#087f8c;font-size:24px;line-height:1">&#9825;</td>
<td style="font-size:16px;line-height:1.5;color:#1f2937"><strong>e-Zdravstvo</strong><br><span style="font-size:14px;color:#526173">${details ? "Automatska potvrda termina" : "Automatska obavijest"}</span></td></tr></table>
<div style="margin-top:20px;border-top:1px solid #dce2e8"></div>
<h1 style="margin:24px 0 20px;font-size:18px;line-height:1.5;color:#111827"><span style="color:${accent}">${event === "CANCELLED" ? "&#8855;" : "&#10003;"}</span>&nbsp; ${escapeHtml(heading)}</h1>
<p style="margin:0 0 16px;font-size:16px;line-height:1.6">Poštovani/a,</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.6">${escapeHtml(intro)}</p>
${attachmentNotice ? `<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#526173">${escapeHtml(attachmentNotice)}</p>` : ""}
${details ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td style="padding:12px;border-bottom:1px solid #dce2e8;font-size:12px;color:#526173">Status rezervacije</td><td align="right" style="padding:12px;border-bottom:1px solid #dce2e8"><span style="display:inline-block;border-radius:16px;background:${badgeBackground};color:${accent};padding:5px 10px;font-size:12px;font-weight:bold">${status}</span></td></tr></table>` : ""}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows.map(([label, value]) => `<tr><td style="padding:10px 12px;font-size:16px;line-height:1.5;overflow-wrap:anywhere;word-break:break-word;color:#1f2937"><span style="font-size:12px;color:#526173">${escapeHtml(label)}</span><br><strong style="display:inline-block;padding-top:5px">${escapeHtml(value)}</strong></td></tr>`).join("")}</table>
${instructions ? `<p style="margin:24px 0 16px;font-size:16px;line-height:1.6">${escapeHtml(instructions)}</p>` : ""}
<p style="margin:20px 0;font-size:16px;line-height:1.6">Srdačan pozdrav,<br>Tim e-Zdravstvo</p>
${portalAccess ? `<p style="margin:20px 0"><a href="${escapeHtml(link)}" style="color:#087f8c;text-decoration:underline;font-size:14px">Otvori e-Zdravstvo</a></p>` : ""}
<p style="font-size:13px;line-height:1.6;color:#526173">${escapeHtml(contact)}</p>
<div style="margin:20px 0;border-top:1px solid #dce2e8"></div>
<p style="margin:0;font-size:13px;line-height:1.6;color:#526173">${escapeHtml(footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: `${title} — e-Zdravstvo`, text, html };
}
export async function deliverNotification(
  job: EmailJob,
  config: EmailConfiguration,
  request: typeof fetch = fetch,
): Promise<DeliveryOutcome> {
  if (config.from !== APPOINTMENT_SENDER)
    throw new Error("Unexpected notification sender");
  const content = renderNotification(job, config.applicationUrl);
  const details = job.appointment ?? job.confirmation;
  const attachments = job.document
    ? [
        {
          filename: `${job.document.number}.pdf`,
          content: bytesToBase64(await documentPdf(job.document)),
          content_type: "application/pdf",
        },
      ]
    : details
      ? [
          {
            filename: `${details.eventType === "CANCELLED" ? "otkazivanje" : details.eventType === "RESCHEDULED" ? "promjena-termina" : "narudzba"}-${details.bookingReference?.replace(/[^A-Za-z0-9_-]/g, "") || "pacijenta"}.pdf`,
            content: bytesToBase64(await bookingPdf(details)),
            content_type: "application/pdf",
          },
        ]
      : undefined;
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
      ...(attachments ? { attachments } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const error: unknown = await response.json().catch(() => null);
    const domainUnverified =
      response.status === 403 &&
      error !== null &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "validation_error" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.startsWith("The e-zdravstvo.tech domain is not verified.");
    const failureCode: DeliveryFailureCode = domainUnverified
      ? "RESEND_DOMAIN_NOT_VERIFIED"
      : response.status === 401
        ? "RESEND_AUTHENTICATION_FAILED"
        : response.status === 403
          ? "RESEND_ACCESS_DENIED"
          : response.status === 429
            ? "RESEND_RATE_LIMITED"
            : "RESEND_REJECTED";
    const header = Number(response.headers.get("retry-after"));
    return {
      succeeded: false,
      providerId: null,
      failureCode,
      providerStatus: response.status,
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
