import { useParams } from "react-router-dom";
import { ShieldCheck, ShieldX } from "lucide-react";
import { Brand } from "../components/ui/Brand";
import { Disclaimer, ErrorMessage } from "../components/ui/Feedback";
import { useResource } from "../hooks/useResource";
import { verifyDocument } from "../services/documents";
import { documentStatusLabels, kindLabels } from "../types/documents";
import type { DocumentVerification } from "../types/documents";
import { dateLabel } from "../utils/format";
export function VerificationResult({
  data,
}: {
  data: DocumentVerification | null;
}) {
  if (!data)
    return (
      <div className="empty-state">
        <ShieldX size={40} />
        <h2>Dokument nije pronađen</h2>
        <p>Provjerite QR kod ili broj dokumenta.</p>
      </div>
    );
  const valid = [
    "VALID",
    "ISSUED",
    "BOOKED",
    "IN_PROGRESS",
    "DISPENSED",
    "COMPLETED",
  ].includes(data.status);
  return (
    <>
      <div className={valid ? "verification-valid" : "medical-alert"}>
        {valid ? <ShieldCheck size={36} /> : <ShieldX size={36} />}
        <h2>
          {valid
            ? "Autentičnost dokumenta je potvrđena"
            : "Dokument nije važeći"}
        </h2>
      </div>
      <dl>
        {[
          ["Broj", data.number],
          ["Vrsta", kindLabels[data.kind]],
          ["Izdavatelj", data.issuer],
          ["Ustanova", data.institution],
          ["Datum izdavanja", dateLabel(data.issued_at)],
          ["Vrijedi do", dateLabel(data.expires_on)],
          ["Status", documentStatusLabels[data.status] ?? data.status],
        ].map(([key, value]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="signature-note">
        Razvojni digitalni potpis – nije kvalificirani elektronički potpis.
      </p>
    </>
  );
}
export function VerificationPage() {
  const { token = "" } = useParams();
  const result = useResource(() => verifyDocument(token), token);
  return (
    <main className="standalone verify-card">
      <Brand />
      <div className="eyebrow spaced">PROVJERA DOKUMENTA</div>
      {result.loading ? (
        <p role="status">Provjera autentičnosti…</p>
      ) : result.error ? (
        <ErrorMessage>{result.error}</ErrorMessage>
      ) : (
        <VerificationResult data={result.data ?? null} />
      )}
      <Disclaimer />
    </main>
  );
}
