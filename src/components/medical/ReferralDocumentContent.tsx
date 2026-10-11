import { referralTypeLabels } from "../../../supabase/functions/notifications-dispatch/document-layout-model";
import type { ClinicalDocument } from "../../types/documents";
import { documentStatusLabels } from "../../types/documents";
import { dateLabel } from "../../utils/format";
export function ReferralDocumentContent({
  document: d,
}: {
  document: ClinicalDocument;
}) {
  const p = d.payload,
    t = p.details,
    type = referralTypeLabels[t.referral_type ?? ""] ?? t.referral_type;
  const row = (label: string, text?: string | null) => (
    <div className="referral-sheet-row">
      <dt>{label}</dt>
      <dd>{text || "—"}</dd>
    </div>
  );
  const band = (text: string) => (
    <h4 className="referral-sheet-band">
      <span>-</span>
      {text}
    </h4>
  );
  return (
    <article className="referral-sheet">
      <p className="referral-sheet-date">
        Uputnica propisana {dateLabel(d.issued_at)}
      </p>
      <h3>{t.specialty || "Uputnica"}</h3>
      <h4 className="referral-sheet-details">Detalji uputnice</h4>
      <dl>
        {row("Vrsta pregleda", type)}
        {row("Propisao", p.institution + "\n" + p.doctor)}
        {row("Upućuje se specijalistu", t.specialty)}
      </dl>
      {band("Postupci")}
      <dl>
        {row("-", type)}
        {row("Razlog upućivanja", t.reason)}
      </dl>
      {band("Dijagnoze")}
      <dl>
        {row("Dijagnoza", t.diagnosis)}
        {t.notes && row("Napomena", t.notes)}
        {row("ID uputnice", d.number)}
      </dl>
      <dl className="referral-sheet-identification">
        {row("Pacijent", p.patient.first_name + " " + p.patient.last_name)}
        {row(
          "Rođen / broj pacijenta",
          dateLabel(p.patient.birth_date) + " / " + p.patient.patient_number,
        )}
        {row("Prioritet", t.priority === "URGENT" ? "Hitno" : "Redovno")}
        {row("Vrijedi do", dateLabel(d.expires_on))}
        {row("Status", documentStatusLabels[d.status] ?? d.status)}
      </dl>
      {d.revocation_reason && (
        <p className="error-message">
          Dokument je opozvan: {d.revocation_reason}
        </p>
      )}
      <details className="signature-details">
        <summary>
          {d.signature.status === "REVOKED"
            ? "Potpis opozvan"
            : d.signature.integrity_valid
              ? "Digitalno potpisano"
              : "Integritet nije potvrđen"}
        </summary>
        <p>Potpisano: {dateLabel(d.signature.signed_at)}</p>
        <p>
          {d.signature.certificate_name} · {d.signature.signature_method}
        </p>
        <code>{d.signature.signature_hash}</code>
        <p>{p.signature_disclaimer}</p>
      </details>
    </article>
  );
}
