import { useState } from "react";
import { vaccinations, type Vaccination } from "../../services/vaccinations";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { dateLabel, readableError } from "../../utils/format";
import { zagrebDate } from "../../utils/calendar";
export function VaccinationPanel({
  personal = false,
  patientId,
  canWrite = false,
}: {
  personal?: boolean;
  patientId?: string;
  canWrite?: boolean;
}) {
  const resource = useResource(
    () => vaccinations(personal, patientId),
    String(personal) + (patientId ?? ""),
  );
  useScheduleRefresh(resource.refresh);
  const [edit, setEdit] = useState<Vaccination | null | false>(false),
    [filter, setFilter] = useState(""),
    [history, setHistory] = useState(false);
  const rows =
    resource.data?.filter(
      (v) =>
        (history || !v.superseded_by) &&
        (v.vaccine + " " + v.target_disease)
          .toLowerCase()
          .includes(filter.toLowerCase()),
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Cijepljenja</h2>
          <p>Evidencija cijepljenja unesena u e-Zdravstvo.</p>
        </div>
        {canWrite && patientId && (
          <button className="primary" onClick={() => setEdit(null)}>
            Evidentiraj cijepljenje
          </button>
        )}
      </div>
      <div className="form-grid">
        <label className="field">
          <span>Pretraži cjepivo ili bolest</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Primjer: COVID-19"
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={history}
            onChange={(e) => setHistory(e.target.checked)}
          />{" "}
          Prikaži prethodne verzije
        </label>
      </div>
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje cijepljenja…</p>
      ) : rows.length ? (
        rows.map((v) => (
          <section className="card spaced" key={v.id}>
            <h3>
              {v.vaccine} · {v.target_disease}
            </h3>
            <p>
              Doza: {v.dose} · {dateLabel(v.administered_on)} · Serija:{" "}
              {v.batch}
            </p>
            <p>
              {v.institution_name} · {v.doctor_name}
            </p>
            {v.next_dose_on && (
              <p>
                Sljedeća doza prema upisu liječnika: {dateLabel(v.next_dose_on)}
              </p>
            )}
            {v.notes && <p className="note-text">{v.notes}</p>}
            {v.superseded_by && (
              <p className="medical-alert">Zamijenjeno novijom verzijom</p>
            )}
            {v.correction_reason && (
              <p>Razlog ispravka: {v.correction_reason}</p>
            )}
            {v.can_amend && !v.superseded_by && (
              <button className="secondary" onClick={() => setEdit(v)}>
                Ispravi evidenciju
              </button>
            )}
          </section>
        ))
      ) : (
        <section className="card empty-state">
          Nema cijepljenja za odabrani prikaz.
        </section>
      )}
      {edit !== false && patientId && (
        <VaccinationEditor
          patientId={patientId}
          previous={edit ?? undefined}
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
function VaccinationEditor({
  patientId,
  previous,
  onClose,
  onSaved,
}: {
  patientId: string;
  previous?: Vaccination;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [request] = useState(crypto.randomUUID());
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("record_vaccination", {
          patient_id: patientId,
          previous_id: previous?.id ?? null,
          data: values(e.currentTarget),
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
      title={previous ? "Ispravak cijepljenja" : "Evidentiraj cijepljenje"}
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <Field
            name="vaccine"
            label="Cjepivo"
            required
            maxLength={200}
            defaultValue={previous?.vaccine}
          />
          <Field
            name="target_disease"
            label="Bolest / cilj cijepljenja"
            required
            maxLength={200}
            defaultValue={previous?.target_disease}
          />
          <Field
            name="dose"
            label="Doza"
            required
            maxLength={100}
            defaultValue={previous?.dose}
          />
          <Field
            name="batch"
            label="Serija"
            required
            maxLength={100}
            defaultValue={previous?.batch}
          />
          <Field
            name="administered_on"
            label="Datum cijepljenja"
            type="date"
            required
            max={zagrebDate()}
            defaultValue={previous?.administered_on ?? zagrebDate()}
          />
          <Field
            name="next_dose_on"
            label="Sljedeća doza (opcionalno)"
            type="date"
            defaultValue={previous?.next_dose_on ?? ""}
          />
        </div>
        <Field
          name="notes"
          label="Napomena"
          type="textarea"
          maxLength={2000}
          defaultValue={previous?.notes}
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
        <p className="confirm-box">
          Potvrdom objavljujete evidenciju pacijentu. Ispravci se čuvaju kao
          nove verzije.
        </p>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="modal-actions">
          <button className="primary" disabled={busy}>
            Potvrdi evidenciju
          </button>
        </div>
      </form>
    </Modal>
  );
}
