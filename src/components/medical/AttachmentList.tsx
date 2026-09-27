import { useState } from "react";
import { Upload, FileText, Download, Archive } from "lucide-react";
import { useResource } from "../../hooks/useResource";
import {
  listAttachments,
  uploadAttachment,
  downloadAttachment,
} from "../../services/attachments";
import { unwrap } from "../../services/clinical";
import { db } from "../../lib/supabase";
import { attachmentCategories } from "../../types/attachments";
import type { Attachment } from "../../types/attachments";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel, readableError } from "../../utils/format";
export function AttachmentList({
  patientId,
  canUpload,
  version = 0,
  onChanged,
}: {
  patientId: string;
  canUpload: boolean;
  version?: number;
  onChanged?: () => void;
}) {
  const [includeArchived, setIncludeArchived] = useState(false),
    [upload, setUpload] = useState(false),
    [archive, setArchive] = useState<Attachment | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const resource = useResource(
    () => listAttachments(patientId, includeArchived),
    `${patientId}:${includeArchived}:${version}`,
  );
  function changed(message: string) {
    setSuccess(message);
    resource.refresh();
    onChanged?.();
  }
  async function download(a: Attachment) {
    setBusy(true);
    setError("");
    try {
      await downloadAttachment(a.id, a.file_name);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function archiveFile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!archive) return;
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("archive_attachment", {
          attachment_id: archive.id,
          reason: values(e.currentTarget).reason,
        }),
      );
      setArchive(null);
      changed("Dokument je arhiviran. Original ostaje sačuvan.");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="attachment-section">
      <div className="section-heading">
        <div>
          <h2>Učitani dokumenti</h2>
          <p className="note-text">
            Nalazi, otpusna pisma i ostala dokumentacija.
          </p>
        </div>
        {canUpload && (
          <button className="primary" onClick={() => setUpload(true)}>
            <Upload size={17} />
            Učitaj dokument
          </button>
        )}
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={includeArchived}
          onChange={(e) => setIncludeArchived(e.target.checked)}
        />
        Prikaži arhivirane dokumente
      </label>
      {error && <ErrorMessage>{error}</ErrorMessage>}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {success && (
        <p role="status" className="success-toast">
          {success}
        </p>
      )}
      {resource.loading ? (
        <p role="status">Učitavanje privitaka…</p>
      ) : (
        <div className="section-stack">
          {resource.data?.length ? (
            resource.data.map((a) => (
              <article className="card" key={a.id}>
                <div className="item-head">
                  <div>
                    <h3>
                      <FileText size={18} className="inline-icon" /> {a.title}
                    </h3>
                    <p>
                      {attachmentCategories[a.category]} ·{" "}
                      {dateLabel(a.created_at)} ·{" "}
                      {(a.byte_size / 1024).toFixed(0)} KB
                    </p>
                  </div>
                  <span className="status-text">
                    {a.status === "ARCHIVED" ? "Arhivirano" : "Učitano"}
                  </span>
                </div>
                <p className="note-text">
                  {a.file_name} · Učitao/la: {a.uploaded_by}
                </p>
                <p className="signature-note">
                  Učitana datoteka, bez digitalne potvrde izdavatelja.
                </p>
                {a.archive_reason && (
                  <p className="note-text">
                    Razlog arhiviranja: {a.archive_reason}
                  </p>
                )}
                <div className="document-actions">
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void download(a)}
                  >
                    <Download size={15} />
                    Preuzmi datoteku
                  </button>
                  {a.can_archive && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setArchive(a);
                      }}
                    >
                      <Archive size={15} />
                      Arhiviraj
                    </button>
                  )}
                </div>
              </article>
            ))
          ) : (
            <section className="card empty-state">
              <FileText size={30} />
              <h3>Nema učitanih dokumenata</h3>
              <p>
                Ovdje će se prikazivati datoteke koje učitate vi ili vaš
                liječnik.
              </p>
            </section>
          )}
        </div>
      )}
      {upload && (
        <UploadModal
          patientId={patientId}
          close={() => setUpload(false)}
          saved={() => {
            setUpload(false);
            changed("Dokument je uspješno učitan.");
          }}
        />
      )}
      {archive && (
        <Modal
          title="Arhiviranje dokumenta"
          onClose={() => setArchive(null)}
          busy={busy}
        >
          <form onSubmit={archiveFile}>
            <p className="form-intro">
              Arhivirati „{archive.title}”? Datoteka ostaje sačuvana i dostupna
              uz prikaz arhiviranih dokumenata.
            </p>
            <Field
              name="reason"
              label="Razlog arhiviranja"
              type="textarea"
              required
              minLength={5}
              maxLength={2000}
            />
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setArchive(null)}
              >
                Odustani
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Arhiviranje…" : "Potvrdi arhiviranje"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
function UploadModal({
  patientId,
  close,
  saved,
}: {
  patientId: string;
  close: () => void;
  saved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId, setRequestId] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget),
      file = form.get("file");
    if (!(file instanceof File) || !file.size) {
      setError("Odaberite datoteku.");
      return;
    }
    if (file.size > 10485760) {
      setError("Datoteka smije imati najviše 10 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await uploadAttachment(
        patientId,
        String(form.get("title")),
        String(form.get("category")),
        file,
        requestId,
      );
      saved();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Učitaj dokument" onClose={close} busy={busy}>
      <form
        onSubmit={submit}
        onChange={() => {
          if (!busy) setRequestId(crypto.randomUUID());
        }}
      >
        <fieldset disabled={busy} className="upload-fields">
          <Field
            label="Naziv dokumenta"
            name="title"
            required
            maxLength={200}
          />
          <Field label="Vrsta dokumenta" name="category">
            {Object.entries(attachmentCategories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </Field>
          <label className="field">
            <span>Datoteka (PDF, JPEG ili PNG, do 10 MB)</span>
            <input
              name="file"
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              required
            />
          </label>
        </fieldset>
        <p className="form-intro spaced">
          Dokument će biti dostupan pacijentu i ovlaštenom timu koji skrbi o
          njemu. Koristite isključivo izmišljene testne podatke.
        </p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={close}
          >
            Odustani
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Prijenos i provjera datoteke…" : "Spremi dokument"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
