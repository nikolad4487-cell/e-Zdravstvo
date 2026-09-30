import { useState } from "react";
import {
  medicalReports,
  downloadMedicalReport,
  type MedicalReport,
} from "../../services/reports";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel, readableError } from "../../utils/format";
import { zagrebDate } from "../../utils/calendar";
export function MedicalReports({
  personal = false,
  patientId,
  canPublish = false,
}: {
  personal?: boolean;
  patientId?: string;
  canPublish?: boolean;
}) {
  const [page, setPage] = useState(0),
    [onlyCurrent, setOnlyCurrent] = useState(true),
    [search, setSearch] = useState(""),
    [edit, setEdit] = useState<MedicalReport | null | false>(false),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState("");
  const resource = useResource(
    () => medicalReports(personal, patientId, page),
    String(personal) + (patientId ?? "") + page,
  );
  useScheduleRefresh(resource.refresh);
  async function download(id: string) {
    setBusy(id);
    setError("");
    try {
      await downloadMedicalReport(id);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(null);
    }
  }
  const rows =
    resource.data?.filter(
      (r) =>
        (!onlyCurrent || !r.superseded_by) &&
        [
          r.institution_name,
          r.specialty,
          r.number,
          r.report_type,
          r.reported_on,
        ]
          .join(" ")
          .toLocaleLowerCase("hr")
          .includes(search.toLocaleLowerCase("hr")),
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Specijalistički nalazi</h2>
          <p>Nalazi, otpusna pisma i prethodne verzije.</p>
        </div>
        {canPublish && patientId && (
          <button className="primary" onClick={() => setEdit(null)}>
            Novi nalaz
          </button>
        )}
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Pretraži prikazane nalaze</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label>
          <input
            type="checkbox"
            checked={onlyCurrent}
            onChange={(e) => setOnlyCurrent(e.target.checked)}
          />{" "}
          Samo važeće verzije
        </label>
      </div>
      {(resource.error || error) && (
        <ErrorMessage>{resource.error || error}</ErrorMessage>
      )}
      {resource.loading ? (
        <p role="status">Učitavanje nalaza…</p>
      ) : !rows.length ? (
        <section className="card empty-state">
          Nema nalaza za ovaj prikaz.
        </section>
      ) : (
        rows.map((r) => (
          <section className="card spaced" key={r.id}>
            <div className="section-heading">
              <h3>
                {r.report_type === "DISCHARGE"
                  ? "Otpusno pismo"
                  : "Specijalistički nalaz"}
              </h3>
              <small>
                {dateLabel(r.reported_on)} · verzija {r.version}
              </small>
            </div>
            <p>
              {r.institution_name} · {r.specialty}
            </p>
            <p>
              {r.doctor_name} · {r.number}
            </p>
            {!personal && (
              <p>
                {r.patient_name} · {r.patient_number}
              </p>
            )}
            {r.superseded_by && (
              <p className="medical-alert">Zamijenjeno novijom verzijom</p>
            )}
            <details>
              <summary>Detalji nalaza</summary>
              {[
                ["Dijagnoze", r.diagnosis],
                ["Nalaz", r.content],
                ["Zaključak", r.conclusion],
                ["Preporuke", r.recommendations],
                ["Razlog ispravka", r.correction_reason],
              ].map(
                ([k, v]) =>
                  v && (
                    <div key={k}>
                      <h4>{k}</h4>
                      <p className="note-text">{v}</p>
                    </div>
                  ),
              )}
            </details>
            <div className="document-actions">
              <button
                className="primary"
                disabled={busy !== null}
                onClick={() => void download(r.id)}
              >
                {busy === r.id ? "Priprema…" : "Preuzmi nalaz PDF"}
              </button>
              {r.can_amend && !r.superseded_by && (
                <button className="secondary" onClick={() => setEdit(r)}>
                  Ispravi nalaz
                </button>
              )}
            </div>
          </section>
        ))
      )}
      <div className="document-actions">
        <button
          className="secondary"
          disabled={page === 0 || resource.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodna
        </button>
        <span>Stranica {page + 1}</span>
        <button
          className="secondary"
          disabled={resource.data?.length !== 50 || resource.loading}
          onClick={() => setPage(page + 1)}
        >
          Sljedeća
        </button>
      </div>
      {edit !== false && (patientId || edit) && (
        <ReportEditor
          patientId={patientId ?? (edit as MedicalReport).patient_id}
          previous={edit ?? undefined}
          bookingId={edit?.booking_id ?? undefined}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            resource.refresh();
          }}
        />
      )}
    </>
  );
}
export function ReportEditor({
  patientId,
  bookingId,
  previous,
  onClose,
  onSaved,
}: {
  patientId: string;
  bookingId?: string;
  previous?: MedicalReport;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<Record<string, string> | null>(null),
    [request] = useState(crypto.randomUUID());
  async function publish() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("publish_medical_report", {
          patient_id: patientId,
          booking_id: bookingId ?? null,
          previous_id: previous?.id ?? null,
          data: draft,
          request_id: request,
        }),
      );
      onSaved();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={previous ? "Ispravak nalaza" : "Novi nalaz"}
      wide
      busy={busy}
      onClose={onClose}
    >
      {draft ? (
        <div className="modal-content">
          <h3>Potvrda objave</h3>
          <p className="confirm-box">
            Nalaz će biti vidljiv pacijentu i njegovu ovlaštenom skrbnom timu.
            Nakon objave ispravak se izdaje kao nova verzija.
          </p>
          <p className="note-text">{draft.content}</p>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Natrag
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void publish()}
            >
              Potvrdi objavu nalaza
            </button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setDraft(values(e.currentTarget));
          }}
        >
          <div className="form-grid">
            <Field
              name="report_type"
              label="Vrsta"
              defaultValue={previous?.report_type ?? "SPECIALIST"}
            >
              <option value="SPECIALIST">Specijalistički nalaz</option>
              <option value="DISCHARGE">Otpusno pismo</option>
            </Field>
            <Field
              name="reported_on"
              label="Datum nalaza"
              type="date"
              required
              defaultValue={previous?.reported_on ?? zagrebDate()}
              max={zagrebDate()}
            />
          </div>
          <Field
            name="diagnosis"
            label="Dijagnoze i šifre"
            type="textarea"
            maxLength={2000}
            defaultValue={previous?.diagnosis}
          />
          <Field
            name="content"
            label="Tekst nalaza"
            type="textarea"
            required
            minLength={2}
            maxLength={20000}
            defaultValue={previous?.content}
          />
          <Field
            name="conclusion"
            label="Zaključak / mišljenje specijalista"
            type="textarea"
            defaultValue={previous?.conclusion}
          />
          <Field
            name="recommendations"
            label="Preporuke"
            type="textarea"
            defaultValue={previous?.recommendations}
          />
          {previous && (
            <Field
              name="correction_reason"
              label="Razlog ispravka"
              required
              minLength={5}
              maxLength={1000}
            />
          )}
          <div className="modal-actions">
            <button className="primary">Pregledaj prije objave</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
