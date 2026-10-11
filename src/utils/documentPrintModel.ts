import type { ClinicalDocument } from "../types/documents";
import { documentStatusLabels } from "../types/documents";
import type { DocumentEmailDetails } from "../../supabase/functions/notifications-dispatch/document-pdf";
export function referralPrintModel(d: ClinicalDocument): DocumentEmailDetails {
  const p = d.payload,
    t = p.details;
  const date = (value: string, time = false) =>
    new Intl.DateTimeFormat("hr-HR", {
      timeZone: "Europe/Zagreb",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(new Date(value));
  return {
    kind: "REFERRAL",
    title: "Uputnica",
    number: d.number,
    issuedAt: d.issued_at,
    layoutVersion: 2,
    layout: {
      status: documentStatusLabels[d.status] ?? d.status,
      verificationToken: d.verification_token,
    },
    sections: [
      {
        label: "Pacijent",
        text: p.patient.first_name + " " + p.patient.last_name,
      },
      {
        label: "Datum rođenja / broj pacijenta",
        text: p.patient.birth_date + " / " + p.patient.patient_number,
      },
      {
        label: "Liječnik / ustanova",
        text: [p.doctor, p.institution, p.institution_address].join("\n"),
      },
      {
        label: "Izdano / vrijedi do",
        text: date(d.issued_at, true) + " / " + date(d.expires_on),
      },
      {
        label: "Vrsta / specijalnost",
        text: (t.referral_type ?? "") + " / " + (t.specialty ?? ""),
      },
      {
        label: "Prioritet",
        text: t.priority === "URGENT" ? "Hitno" : "Redovno",
      },
      { label: "Razlog upućivanja", text: t.reason ?? "" },
      { label: "Dijagnoza", text: t.diagnosis ?? "" },
      { label: "Napomena", text: t.notes ?? "" },
      { label: "Elektronički potpis", text: p.signature_disclaimer },
      {
        label: "Oznaka potpisa",
        text: d.signature.signature_method + ": " + d.signature.signature_hash,
      },
      ...(d.revocation_reason
        ? [{ label: "Razlog opoziva", text: d.revocation_reason }]
        : []),
    ],
  };
}
