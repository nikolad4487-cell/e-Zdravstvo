import { InpatientMedication } from "./InpatientMedication";
import { useCallback, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  inpatientContext,
  inpatients,
  inpatientDetails,
  inpatientCommand,
  type Inpatient,
  type InpatientNote,
} from "../../services/inpatient";
import { searchPatients } from "../../services/clinical";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { ReportEditor } from "./MedicalReports";
import { downloadMedicalReport } from "../../services/reports";
import { dateLabel, readableError } from "../../utils/format";
import { zagrebDate, zagrebTime } from "../../utils/calendar";
export function InpatientCare({
  patientId,
  patientName,
}: {
  patientId?: string;
  patientName?: string;
}) {
  const auth = useAuth();
  const [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [page, setPage] = useState(0),
    [closed, setClosed] = useState(false),
    [admitting, setAdmitting] = useState(false),
    [patientSearch, setPatientSearch] = useState(""),
    [selectedPatient, setSelectedPatient] = useState(patientId ?? ""),
    [request, setRequest] = useState(crypto.randomUUID()),
    [detail, setDetail] = useState<Inpatient | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const context = useResource(inpatientContext, "inpatient-context");
  const resource = useResource(
    () => inpatients(patientId, search, closed, page),
    JSON.stringify([patientId, search, closed, page]),
  );
  const patients = useResource(
    () =>
      admitting && !patientId
        ? searchPatients(patientSearch)
        : Promise.resolve([]),
    JSON.stringify([admitting, patientId, patientSearch]),
  );
  const refresh = useCallback(() => {
    resource.refresh();
    context.refresh();
  }, [resource.refresh, context.refresh]);
  useScheduleRefresh(refresh);
  async function admit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = values(e.currentTarget);
    try {
      await inpatientCommand("admit_inpatient", {
        patient_id: patientId ?? selectedPatient,
        bed_id: data.bed_id,
        reason: data.reason,
        request_id: request,
      });
      setAdmitting(false);
      setSuccess("Bolnički prijam je evidentiran.");
      refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const free =
    context.data?.beds.filter(
      (b) =>
        b.active &&
        !b.occupied &&
        context.data?.wards.some((w) => w.id === b.ward_id && w.active),
    ) ?? [];
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Hospitalizacije</h2>
          <p>Prijam, smještaj, bilješke skrbi, premještaji i otpust.</p>
        </div>
        {auth.roles.includes("DOCTOR") && (
          <button
            type="button"
            className="primary"
            onClick={() => {
              setAdmitting(true);
              setRequest(crypto.randomUUID());
              setError("");
            }}
          >
            Novi bolnički prijam
          </button>
        )}
      </div>
      <form
        className="card spaced"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft.trim());
          setPage(0);
        }}
      >
        <Field
          name="inpatient_search"
          label="Pacijent, odjel ili krevet"
          value={draft}
          maxLength={200}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="document-actions spaced">
          <button className="primary">Pretraži</button>
          <label>
            <input
              type="checkbox"
              checked={closed}
              onChange={(e) => {
                setClosed(e.target.checked);
                setPage(0);
              }}
            />{" "}
            Prikaži otpuštene pacijente
          </label>
          <button type="button" className="secondary" onClick={refresh}>
            Osvježi prijame
          </button>
        </div>
      </form>
      {success && (
        <p role="status" className="feedback success">
          {success}
        </p>
      )}
      {(resource.error || context.error || (error && !admitting)) && (
        <ErrorMessage>{resource.error || context.error || error}</ErrorMessage>
      )}
      {resource.loading ? (
        <p role="status">Učitavanje hospitalizacija…</p>
      ) : resource.data?.items.length ? (
        <div className="section-stack">
          {resource.data.items.map((a) => (
            <section className="card" key={a.id}>
              <div className="section-heading">
                <h3>{a.patient_name}</h3>
                <span className="sample-stage">
                  {a.status === "ADMITTED" ? "Hospitaliziran/a" : "Otpušten/a"}
                </span>
              </div>
              <p>
                {a.patient_number} · {a.institution_name}
              </p>
              <p>
                {a.ward_name} · {a.bed_label}
              </p>
              <p>
                Prijam: {dateLabel(zagrebDate(new Date(a.admitted_at)))} u{" "}
                {zagrebTime(a.admitted_at)}
              </p>
              {a.discharged_at && (
                <p>
                  Otpust: {dateLabel(zagrebDate(new Date(a.discharged_at)))}
                </p>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => setDetail(a)}
              >
                Otvori bolničku skrb
              </button>
            </section>
          ))}
        </div>
      ) : (
        <section className="card empty-state">
          Nema hospitalizacija u vašem skrbnom opsegu za odabrane filtre.
        </section>
      )}
      <div className="document-actions spaced">
        <button
          type="button"
          className="secondary"
          disabled={page === 0 || resource.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodna stranica
        </button>
        <span>
          {resource.data?.total ?? 0} prijama · stranica {page + 1}
        </span>
        <button
          type="button"
          className="secondary"
          disabled={
            (page + 1) * 50 >= (resource.data?.total ?? 0) || resource.loading
          }
          onClick={() => setPage(page + 1)}
        >
          Sljedeća stranica
        </button>
      </div>
      {admitting && (
        <Modal
          title="Novi bolnički prijam"
          busy={busy}
          wide
          onClose={() => {
            setAdmitting(false);
            setError("");
          }}
        >
          <form onSubmit={admit}>
            {patientId ? (
              <p>Pacijent: {patientName ?? "Pacijent iz otvorenog kartona"}</p>
            ) : (
              <>
                <Field
                  name="patient_search"
                  label="Traži pacijenta za prijam"
                  value={patientSearch}
                  maxLength={100}
                  onChange={(e) => {
                    setPatientSearch(e.target.value);
                    setSelectedPatient("");
                  }}
                />
                <Field
                  name="inpatient_patient"
                  label="Pacijent"
                  required
                  value={selectedPatient}
                  onChange={(e) => setSelectedPatient(e.target.value)}
                >
                  <option value="">
                    Odaberite pacijenta iz svog skrbnog tima
                  </option>
                  {patients.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.first_name} {p.last_name} · {p.patient_number}
                    </option>
                  ))}
                </Field>
              </>
            )}
            <Field name="bed_id" label="Slobodan krevet" required>
              <option value="">Odaberite smještaj</option>
              {free.map((b) => (
                <option key={b.id} value={b.id}>
                  {
                    context.data?.institutions.find(
                      (i) => i.id === b.institution_id,
                    )?.name
                  }{" "}
                  · {b.ward_name} · {b.label}
                </option>
              ))}
            </Field>
            {!free.length && (
              <p>
                Nema slobodnih kreveta. Administrator ustanove treba postaviti
                odjel i krevete.
              </p>
            )}
            <Field
              name="reason"
              label="Razlog bolničkog prijama"
              type="textarea"
              required
              minLength={5}
              maxLength={4000}
            />
            <p className="note-text">
              Prijam evidentira odgovorni liječnik s pristupom pacijentu i
              liječničkom ulogom u odabranoj ustanovi.
            </p>
            {(error || patients.error) && (
              <ErrorMessage>{error || patients.error}</ErrorMessage>
            )}
            <div className="modal-actions">
              <button className="primary" disabled={busy || !free.length}>
                Potvrdi prijam
              </button>
            </div>
          </form>
        </Modal>
      )}
      {detail && (
        <InpatientDetail
          admission={detail}
          onClose={() => setDetail(null)}
          onChanged={refresh}
        />
      )}
    </>
  );
}
function InpatientDetail({
  admission,
  onClose,
  onChanged,
}: {
  admission: Inpatient;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [medicating, setMedicating] = useState(false);
  const [savedRevision, setSavedRevision] = useState(0);
  const [page, setPage] = useState(0),
    [action, setAction] = useState<"NOTE" | "TRANSFER" | "DISCHARGE" | null>(
      null,
    ),
    [correction, setCorrection] = useState<InpatientNote | null>(null),
    [request, setRequest] = useState(crypto.randomUUID()),
    [reporting, setReporting] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const resource = useResource(
    () => inpatientDetails(admission.id, page),
    JSON.stringify([admission.id, page]),
  );
  const context = useResource(inpatientContext, "inpatient-detail-context");
  const refreshDetail = useCallback(() => {
    if (!action && !reporting && !medicating) {
      resource.refresh();
      context.refresh();
    }
  }, [action, reporting, medicating, resource.refresh, context.refresh]);
  useScheduleRefresh(refreshDetail);
  const data = resource.data;
  const current = data?.admission;
  function open(
    kind: "NOTE" | "TRANSFER" | "DISCHARGE",
    note: InpatientNote | null = null,
  ) {
    setAction(kind);
    setCorrection(note);
    setRequest(crypto.randomUUID());
    setError("");
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!current) return;
    const form = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (action === "NOTE")
        await inpatientCommand("add_inpatient_note", {
          admission_id: current.id,
          kind: correction?.kind ?? form.kind,
          content: form.content,
          request_id: request,
          corrects_note_id: correction?.id ?? null,
          correction_reason: form.correction_reason ?? "",
        });
      else if (action === "TRANSFER")
        await inpatientCommand("move_inpatient", {
          admission_id: current.id,
          bed_id: form.bed_id,
          expected_version: current.version,
          reason: form.reason,
        });
      else
        await inpatientCommand("discharge_inpatient", {
          admission_id: current.id,
          expected_version: current.version,
          report_id: form.report_id,
        });
      setAction(null);
      setCorrection(null);
      setSavedRevision((n) => n + 1);
      setSuccess("Promjena bolničke skrbi je spremljena.");
      resource.refresh();
      context.refresh();
      onChanged();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function download() {
    if (!current?.discharge_report_id) return;
    setBusy(true);
    setError("");
    try {
      await downloadMedicalReport(current.discharge_report_id);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  if (medicating)
    return (
      <InpatientMedication
        admissionId={admission.id}
        patientName={admission.patient_name}
        patientNumber={admission.patient_number}
        onClose={() => {
          setMedicating(false);
          resource.refresh();
        }}
      />
    );
  if (reporting)
    return (
      <ReportEditor
        patientId={admission.patient_id}
        defaultType="DISCHARGE"
        admissionId={admission.id}
        onClose={() => setReporting(false)}
        onSaved={() => {
          setReporting(false);
          resource.refresh();
          onChanged();
        }}
      />
    );
  const beds =
    context.data?.beds.filter(
      (b) =>
        b.institution_id === admission.institution_id &&
        b.active &&
        !b.occupied &&
        b.id !== current?.bed_id &&
        context.data?.wards.some((w) => w.id === b.ward_id && w.active),
    ) ?? [];
  return (
    <Modal
      title={"Bolnička skrb · " + admission.patient_name}
      wide
      busy={busy}
      resetDirtyKey={savedRevision}
      onClose={onClose}
    >
      <div className="modal-content">
        <p>
          {admission.patient_number} · {admission.institution_name}
        </p>
        {success && (
          <p role="status" className="feedback success">
            {success}
          </p>
        )}
        {(error || resource.error || context.error) && (
          <ErrorMessage>
            {error || resource.error || context.error}
          </ErrorMessage>
        )}
        {resource.loading ? (
          <p role="status">Učitavanje bolničke skrbi…</p>
        ) : (
          data &&
          current && (
            <>
              <p>
                <strong>
                  {current.status === "ADMITTED"
                    ? "Aktivan bolnički prijam"
                    : "Pacijent je otpušten"}
                </strong>
              </p>
              <p>{current.reason}</p>
              <div className="document-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={!!action || busy}
                  onClick={() => setMedicating(true)}
                >
                  Terapijski nalozi i primjena lijekova
                </button>
                {current.status === "ADMITTED" && (
                  <>
                    {(data.can_doctor_note || data.can_nurse) && (
                      <button
                        type="button"
                        className="primary"
                        disabled={!!action || busy}
                        onClick={() => open("NOTE")}
                      >
                        Nova bilješka skrbi
                      </button>
                    )}
                    {data.can_manage && (
                      <>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!!action || busy}
                          onClick={() => open("TRANSFER")}
                        >
                          Premjesti pacijenta
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!!action || busy}
                          onClick={() => setReporting(true)}
                        >
                          Izradi otpusno pismo
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={!!action || busy}
                          onClick={() => open("DISCHARGE")}
                        >
                          Otpusti pacijenta
                        </button>
                      </>
                    )}
                  </>
                )}
                {current.discharge_report_id && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={download}
                  >
                    Preuzmi izvorno otpusno pismo
                  </button>
                )}
                <button
                  type="button"
                  className="text-link"
                  disabled={!!action || busy}
                  onClick={() => {
                    resource.refresh();
                    context.refresh();
                  }}
                >
                  Osvježi podatke
                </button>
              </div>
              {action && (
                <form className="card spaced section-stack" onSubmit={save}>
                  {action === "NOTE" ? (
                    <>
                      <h3>
                        {correction
                          ? "Ispravak bilješke"
                          : "Nova bilješka skrbi"}
                      </h3>
                      {!correction && (
                        <Field name="kind" label="Vrsta bilješke" required>
                          {data.can_doctor_note && (
                            <option value="PROGRESS">Liječnički tijek</option>
                          )}
                          {data.can_nurse && (
                            <option value="NURSING">Sestrinska bilješka</option>
                          )}
                        </Field>
                      )}
                      <Field
                        name="content"
                        label="Sadržaj bilješke"
                        type="textarea"
                        required
                        minLength={5}
                        maxLength={8000}
                        defaultValue={correction?.content ?? ""}
                      />
                      {correction && (
                        <Field
                          name="correction_reason"
                          label="Razlog ispravka bilješke"
                          type="textarea"
                          required
                          minLength={5}
                          maxLength={1000}
                        />
                      )}
                    </>
                  ) : action === "TRANSFER" ? (
                    <>
                      <h3>Premještaj pacijenta</h3>
                      <Field name="bed_id" label="Novi krevet" required>
                        <option value="">
                          Odaberite slobodan krevet iste ustanove
                        </option>
                        {beds.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.ward_name} · {b.label}
                          </option>
                        ))}
                      </Field>
                      <Field
                        name="reason"
                        label="Razlog premještaja"
                        type="textarea"
                        required
                        minLength={5}
                        maxLength={1000}
                      />
                    </>
                  ) : (
                    <>
                      <h3>Otpust iz bolnice</h3>
                      <Field
                        name="report_id"
                        label="Izdano otpusno pismo"
                        required
                      >
                        <option value="">
                          Odaberite aktualno otpusno pismo ovog prijama
                        </option>
                        {data.discharge_reports.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.number} · {dateLabel(r.reported_on)}
                          </option>
                        ))}
                      </Field>
                      {!data.discharge_reports.length && (
                        <p>
                          Prvo izdajte otpusno pismo pomoću gumba „Izradi
                          otpusno pismo”.
                        </p>
                      )}
                      <p>
                        Potvrdom otpusta završava hospitalizacija i oslobađa se
                        krevet.
                      </p>
                    </>
                  )}
                  <div className="document-actions">
                    <button className="primary" disabled={busy}>
                      Spremi promjenu
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setAction(null);
                        setCorrection(null);
                        setSavedRevision((n) => n + 1);
                      }}
                    >
                      Odustani
                    </button>
                  </div>
                </form>
              )}
              <h3 className="spaced">Bilješke i prethodne verzije</h3>
              {data.notes.length ? (
                data.notes.map((note) => (
                  <section className="card spaced" key={note.id}>
                    <strong>
                      {note.kind === "NURSING"
                        ? "Sestrinska bilješka"
                        : "Liječnički tijek"}
                      {note.superseded_by ? " · zamijenjena verzija" : ""}
                    </strong>
                    <p className="note-text">
                      {dateLabel(zagrebDate(new Date(note.created_at)))} u{" "}
                      {zagrebTime(note.created_at)} · {note.author}
                    </p>
                    <p className="inpatient-note">{note.content}</p>
                    {note.correction_reason && (
                      <p>Razlog ispravka: {note.correction_reason}</p>
                    )}
                    {note.can_correct &&
                      (note.kind === "NURSING"
                        ? data.can_nurse
                        : data.can_doctor_note) && (
                        <button
                          type="button"
                          className="text-link"
                          disabled={!!action || busy}
                          onClick={() => open("NOTE", note)}
                        >
                          Ispravi vlastitu bilješku
                        </button>
                      )}
                  </section>
                ))
              ) : (
                <p>Nema bilježaka za ovaj prijam.</p>
              )}
              <div className="document-actions spaced">
                <button
                  type="button"
                  className="secondary"
                  disabled={page === 0 || !!action || busy}
                  onClick={() => setPage(page - 1)}
                >
                  Prethodne bilješke
                </button>
                <span>
                  {data.notes_total} bilježaka · stranica {page + 1}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    (page + 1) * 50 >= data.notes_total || !!action || busy
                  }
                  onClick={() => setPage(page + 1)}
                >
                  Sljedeće bilješke
                </button>
              </div>
              <details className="spaced">
                <summary>Povijest prijama, premještaja i otpusta</summary>
                {data.movements.map((m) => (
                  <section key={m.id} className="clinical-note spaced">
                    <strong>
                      {m.kind === "ADMITTED"
                        ? "Prijam"
                        : m.kind === "TRANSFERRED"
                          ? "Premještaj"
                          : "Otpust"}
                    </strong>
                    <p>
                      {m.from_bed ? m.from_bed + " → " : ""}
                      {m.to_bed ?? "Otpust iz bolnice"}
                    </p>
                    <p>
                      {dateLabel(zagrebDate(new Date(m.created_at)))} u{" "}
                      {zagrebTime(m.created_at)} · {m.author}
                    </p>
                    {m.reason && <p>{m.reason}</p>}
                  </section>
                ))}
              </details>
            </>
          )
        )}
      </div>
    </Modal>
  );
}
