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
    t = p.details;
  const row = (label: string, text: string | undefined | null) => (
    <div className="referral-sheet-row">
      <dt>{label}</dt>
      <dd>{text || "Nije navedeno"}</dd>
    </div>
  );
  return (
    <article className="referral-sheet">
      <p className="referral-sheet-date">
        Uputnica propisana {dateLabel(d.issued_at)}
      </p>
      <h3>{t.specialty || "Uputnica"}</h3>
      <h4>Detalji uputnice</h4>
      <dl>
        {row("Pacijent", p.patient.first_name + " " + p.patient.last_name)}
        {row(
          "Vrsta pregleda",
          referralTypeLabels[t.referral_type ?? ""] ?? t.referral_type,
        )}
        {row("Propisao", p.doctor + "\n" + p.institution)}
        {row("Adresa ustanove", p.institution_address)}
        {row("Prioritet", t.priority === "URGENT" ? "Hitno" : "Redovno")}
        {row("Vrijedi do", dateLabel(d.expires_on))}
        {row("Status", documentStatusLabels[d.status] ?? d.status)}
      </dl>
      <h4 className="referral-sheet-band">Razlog upućivanja</h4>
      <p>{t.reason || "Nije navedeno"}</p>
      <h4 className="referral-sheet-band">Dijagnoze</h4>
      <p>{t.diagnosis || "Nije navedeno"}</p>
      <dl>
        {t.notes && row("Napomena", t.notes)}
        {row("ID uputnice", d.number)}
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
