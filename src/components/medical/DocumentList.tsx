import { ReferralDocumentContent } from "./ReferralDocumentContent";
import { useEffect, useState } from "react";
import {
  Download,
  FileCheck2,
  ShieldCheck,
  RefreshCw,
  ExternalLink,
} from "lucide-react";
import QRCode from "qrcode";
import { useResource } from "../../hooks/useResource";
import { useAuth } from "../../hooks/useAuth";
import { Pagination } from "../ui/Pagination";
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
  if (d.kind === "REFERRAL") return <ReferralDocumentContent document={d} />;
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
  const { institutions } = useAuth();
  const [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [page, setPage] = useState(0),
    [status, setStatus] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [institution, setInstitution] = useState(""),
    [selectedKind, setSelectedKind] = useState<DocumentKind | "">("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setPage(0);
  }, [patientId, kind, selectedKind, status, from, to, institution]);
  const resource = useResource(
    async () => {
      if (from && to && from > to)
        throw new Error("Početni datum ne smije biti nakon završnog datuma.");
      return listDocuments(patientId, kind ?? (selectedKind || undefined), {
        search: term,
        page,
        status,
        from,
        to,
        institution,
      });
    },
    JSON.stringify([
      patientId,
      kind,
      selectedKind,
      version,
      term,
      page,
      status,
      from,
      to,
      institution,
    ]),
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
      <div className="card form-grid spaced">
        <Field
          label="Pretraži dokumente"
          name="document_search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          maxLength={100}
          placeholder="Broj dokumenta, pacijent ili liječnik"
        />
        {!kind && (
          <Field
            label="Vrsta dokumenta"
            name="document_kind"
            value={selectedKind}
            onChange={(e) =>
              setSelectedKind(e.target.value as DocumentKind | "")
            }
          >
            <option value="">Sve vrste</option>
            {Object.entries(kindLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Field>
        )}
        <Field
          label="Status dokumenta"
          name="document_status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">Svi statusi</option>
          {[
            "ISSUED",
            "VALID",
            "EXPIRED",
            "REVOKED",
            "CANCELLED",
            "DISPENSED",
            "COMPLETED",
          ].map((value) => (
            <option key={value} value={value}>
              {documentStatusLabels[value]}
            </option>
          ))}
        </Field>
        <Field
          label="Izdano od"
          name="issued_from"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <Field
          label="Izdano do"
          name="issued_to"
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        {institutions.length > 0 && (
          <Field
            label="Ustanova"
            name="document_institution"
            value={institution}
            onChange={(e) => setInstitution(e.target.value)}
          >
            <option value="">Sve dostupne ustanove</option>
            {institutions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Field>
        )}
      </div>
      <div className="section-heading">
        <span className="muted">
          {resource.data?.length ?? 0} dokumenata na stranici
        </span>
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
      <Pagination
        page={page}
        size={resource.data?.length ?? 0}
        loading={resource.loading || search.trim() !== term}
        onChange={setPage}
      />
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
