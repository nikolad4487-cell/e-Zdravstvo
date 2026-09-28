import { useState } from "react";
import {
  Download,
  FileCheck2,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import QRCode from "qrcode";
import { useResource } from "../../hooks/useResource";
import { getDocument, listDocuments } from "../../services/documents";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel, readableError } from "../../utils/format";
import { kindLabels, documentStatusLabels } from "../../types/documents";
import type { ClinicalDocument, DocumentKind } from "../../types/documents";
export function verificationUrl(token: string) {
  return `${window.location.origin}/verify/${token}`;
}
export function DocumentContent({
  document: d,
}: {
  document: ClinicalDocument;
}) {
  const p = d.payload,
    details = p.details;
  return (
    <>
      <dl className="detail-grid">
        <div>
          <dt>Pacijent</dt>
          <dd>
            {p.patient.first_name} {p.patient.last_name}
          </dd>
        </div>
        <div>
          <dt>Liječnik</dt>
          <dd>{p.doctor}</dd>
        </div>
        <div>
          <dt>Ustanova</dt>
          <dd>{p.institution}</dd>
        </div>
        <div>
          <dt>Datum izdavanja</dt>
          <dd>{dateLabel(d.issued_at)}</dd>
        </div>
        <div>
          <dt>Vrijedi do</dt>
          <dd>{dateLabel(d.expires_on)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>{documentStatusLabels[d.status] ?? d.status}</dd>
        </div>
      </dl>
      {details.items?.map((item, i) => (
        <section className="prescription-line" key={i}>
          <h3>
            {item.name} · {item.strength}
          </h3>
          <p className="note-text">
            {item.dosage} · {item.route} · {item.duration}
          </p>
          <p className="note-text">
            Količina: {item.quantity} · {item.packaging}
          </p>
          <p className="note-text">{item.notes}</p>
        </section>
      ))}
      {d.kind === "SCHOOL_EXCUSE" && (
        <div className="confirm-box">
          <strong>
            Opravdani izostanak: {dateLabel(details.date_from)} –{" "}
            {dateLabel(details.date_to)}
          </strong>
          <p>{details.category}</p>
          {details.excuse_type && (
            <p>
              {details.excuse_type === "PE"
                ? "Tjelesna i zdravstvena kultura"
                : "Redovna nastava"}
            </p>
          )}
          {details.clinic && (
            <p>
              {details.clinic.name} · {details.clinic.code}
              <br />
              {details.clinic.address}, {details.clinic.city}
              <br />
              {details.clinic.phone} · {details.clinic.email}
            </p>
          )}
          {details.doctor_code && <p>Šifra liječnika: {details.doctor_code}</p>}
          {details.diagnosis_code && (
            <p>Šifra bolesti: {details.diagnosis_code}</p>
          )}
          <p>{details.school}</p>
        </div>
      )}
      {d.kind === "REFERRAL" && (
        <>
          <h3>
            {details.specialty} ·{" "}
            {details.priority === "URGENT" ? "Hitno" : "Redovno"}
          </h3>
          <p className="note-text">{details.reason}</p>
          <p className="note-text">{details.diagnosis}</p>
        </>
      )}
      <p className="note-text spaced">{details.notes}</p>
      {d.revocation_reason && (
        <ErrorMessage>Dokument je opozvan: {d.revocation_reason}</ErrorMessage>
      )}
      <details className="signature-details">
        <summary>
          <ShieldCheck size={15} />{" "}
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
    </>
  );
}
export function DocumentList({
  patientId,
  kind,
  version = 0,
}: {
  patientId?: string;
  kind?: DocumentKind;
  version?: number;
}) {
  const resource = useResource(
    () => listDocuments(patientId, kind),
    `${patientId ?? ""}:${kind ?? ""}:${version}`,
  );
  const [selected, setSelected] = useState<ClinicalDocument | null>(null),
    [qr, setQr] = useState(""),
    [revoking, setRevoking] = useState<ClinicalDocument | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function view(id: string) {
    setError("");
    setBusy(true);
    try {
      const doc = await getDocument(id);
      setQr(
        await QRCode.toDataURL(verificationUrl(doc.verification_token), {
          width: 180,
          margin: 2,
        }),
      );
      setSelected(doc);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(id: string) {
    setError("");
    setBusy(true);
    try {
      const doc = await getDocument(id, "DOWNLOAD");
      const { downloadDocumentPdf } = await import("../../utils/documentPdf");
      await downloadDocumentPdf(doc, verificationUrl(doc.verification_token));
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function revoke(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!revoking) return;
    const data = values(e.currentTarget);
    setBusy(true);
    try {
      unwrap(
        await db().rpc("revoke_document", {
          document_id: revoking.id,
          reason: data.reason,
        }),
      );
      setRevoking(null);
      setSelected(null);
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="section-heading">
        <span className="muted">{resource.data?.length ?? 0} dokumenata</span>
        <button
          className="text-link"
          onClick={resource.refresh}
          disabled={resource.loading}
        >
          <RefreshCw size={14} />
          Osvježi
        </button>
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje dokumenata…</p>
      ) : (
        <div className="section-stack">
          {resource.data?.length ? (
            resource.data.map((d) => (
              <section className="card" key={d.id}>
                <div className="item-head">
                  <div>
                    <h3>
                      <FileCheck2 size={17} className="inline-icon" />{" "}
                      {kindLabels[d.kind]}
                    </h3>
                    <p className="document-number">{d.number}</p>
                  </div>
                  <span
                    className={
                      "status-text " +
                      (["REVOKED", "CANCELLED", "EXPIRED"].includes(d.status)
                        ? "status-muted"
                        : "")
                    }
                  >
                    {documentStatusLabels[d.status] ?? d.status}
                  </span>
                </div>
                <p className="note-text">
                  {d.payload.patient.first_name} {d.payload.patient.last_name} ·{" "}
                  {d.payload.doctor}
                </p>
                <p className="note-text">
                  Izdano {dateLabel(d.issued_at)} · Vrijedi do{" "}
                  {dateLabel(d.expires_on)}
                </p>
                <div className="document-actions">
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => void view(d.id)}
                  >
                    Otvori dokument
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void download(d.id)}
                  >
                    <Download size={15} className="inline-icon" />
                    Preuzmi PDF
                  </button>
                  {d.can_revoke && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setRevoking(d);
                      }}
                    >
                      Opozovi
                    </button>
                  )}
                </div>
              </section>
            ))
          ) : (
            <section className="card empty-state">
              <FileCheck2 size={30} />
              <h3>Još nema izdanih dokumenata</h3>
              <p>Izdani dokumenti pojavit će se ovdje.</p>
            </section>
          )}
        </div>
      )}
      {selected && (
        <Modal
          title={selected.number}
          onClose={() => setSelected(null)}
          wide
          busy={busy}
        >
          <div className="modal-content">
            <h2>{kindLabels[selected.kind]}</h2>
            <DocumentContent document={selected} />
            <div className="qr-row">
              <img
                src={qr}
                alt="QR kod za provjeru autentičnosti"
                width={150}
                height={150}
              />
              <div>
                <a
                  className="text-link"
                  href={verificationUrl(selected.verification_token)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Provjeri autentičnost <ExternalLink size={14} />
                </a>
                <p className="signature-note">
                  Javna provjera ne prikazuje ime pacijenta ni medicinski
                  sadržaj.
                </p>
              </div>
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void download(selected.id)}
            >
              <Download size={16} />
              Preuzmi PDF
            </button>
          </div>
        </Modal>
      )}
      {revoking && (
        <Modal
          title="Opoziv dokumenta"
          onClose={() => setRevoking(null)}
          busy={busy}
        >
          <form onSubmit={revoke}>
            <p className="form-intro">
              Opozvati {revoking.number}? Original ostaje sačuvan, a javna
              provjera odmah prikazuje novi status.
            </p>
            <Field
              name="reason"
              label="Razlog opoziva (najmanje 5 znakova)"
              type="textarea"
              required
            />
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setRevoking(null)}
              >
                Odustani
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Opozivanje…" : "Potvrdi opoziv"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
