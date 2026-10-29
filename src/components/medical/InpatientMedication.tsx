import { useCallback, useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  inpatientMedications,
  inpatientMedicationHistory,
  medicationCommand,
  zagrebInput,
  type MedicationOrder,
  type MedicationDose,
} from "../../services/inpatientMedication";
import {
  searchPrescriptionMedications,
  type PrescriptionMedication,
} from "../../services/medicalCodes";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel, readableError } from "../../utils/format";
import { zagrebDate, zagrebTime } from "../../utils/calendar";
function timeLabel(value: string) {
  return `${dateLabel(zagrebDate(new Date(value)))} u ${zagrebTime(value)}`;
}
type Action =
  | { kind: "ORDER" }
  | { kind: "STOP"; order: MedicationOrder }
  | {
      kind: "RECORD";
      order: MedicationOrder;
      dose: MedicationDose;
      correct: boolean;
    };
export function InpatientMedication({
  admissionId,
  patientName,
  patientNumber,
  onClose,
}: {
  admissionId: string;
  patientName: string;
  patientNumber: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0),
    [action, setAction] = useState<Action | null>(null),
    [request, setRequest] = useState(crypto.randomUUID()),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [saved, setSaved] = useState(0);
  const [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [medicinePage, setMedicinePage] = useState(0),
    [medicine, setMedicine] = useState<PrescriptionMedication | null>(null),
    [slots, setSlots] = useState([""]);
  const [history, setHistory] = useState<string | null>(null),
    [historyPage, setHistoryPage] = useState(0);
  const resource = useResource(
    () => inpatientMedications(admissionId, page),
    JSON.stringify([admissionId, page]),
  );
  const medicines = useResource(
    () =>
      action?.kind === "ORDER"
        ? searchPrescriptionMedications(term, medicinePage)
        : Promise.resolve([]),
    JSON.stringify([action?.kind, term, medicinePage]),
  );
  const records = useResource(
    () =>
      history
        ? inpatientMedicationHistory(history, historyPage)
        : Promise.resolve(null),
    JSON.stringify([history, historyPage]),
  );
  const refresh = useCallback(() => {
    if (!action) {
      resource.refresh();
      records.refresh();
    }
  }, [action, resource.refresh, records.refresh]);
  useScheduleRefresh(refresh);
  function open(next: Action) {
    setAction(next);
    setError("");
    setRequest(crypto.randomUUID());
    setMedicine(null);
    setSlots([""]);
  }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    const form = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (action.kind === "ORDER") {
        if (!medicine) throw Error("Odaberite lijek iz šifrarnika.");
        await medicationCommand("create_inpatient_medication_order", {
          admission_id: admissionId,
          medication_id: medicine.id,
          dose: form.dose,
          route: form.route,
          instructions: form.instructions,
          scheduled_times: slots,
          request_id: request,
        });
      } else if (action.kind === "STOP")
        await medicationCommand("stop_inpatient_medication_order", {
          order_id: action.order.id,
          expected_version: action.order.version,
          reason: form.reason,
        });
      else {
        if (
          form.outcome === "GIVEN" &&
          (!form.actual_dose?.trim() || form.patient_confirmed !== "on")
        )
          throw Error(
            "Za primjenu unesite stvarnu dozu i potvrdite provjeru identiteta i naloga.",
          );
        if (
          (form.outcome === "NOT_GIVEN" ||
            form.actual_dose?.trim() !== action.order.dose) &&
          (form.note?.trim().length ?? 0) < 5
        )
          throw Error(
            "Unesite obrazloženje neprimjene ili odstupanja od propisane doze (najmanje 5 znakova).",
          );
        await medicationCommand("record_inpatient_medication", {
          dose_id: action.dose.id,
          outcome: form.outcome,
          actual_time: form.actual_time,
          actual_dose: form.actual_dose || null,
          patient_confirmed: form.patient_confirmed === "on",
          note: form.note,
          request_id: request,
          corrects_record_id: action.correct
            ? (action.dose.record?.id ?? null)
            : null,
          correction_reason: form.correction_reason ?? "",
        });
      }
      setAction(null);
      setSaved((n) => n + 1);
      setSuccess("Terapijski zapis je spremljen.");
      resource.refresh();
      records.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const data = resource.data;
  return (
    <Modal
      title={"Bolnička terapija · " + patientName}
      wide
      busy={busy}
      resetDirtyKey={saved}
      onClose={onClose}
    >
      <div className="modal-content section-stack">
        <p>
          <strong>{patientName}</strong> · {patientNumber}
        </p>
        <p>
          Vremena su prikazana i unose se prema vremenu u Hrvatskoj
          (Europe/Zagreb).
        </p>
        {success && (
          <p role="status" className="feedback success">
            {success}
          </p>
        )}
        {(error || resource.error || records.error) && (
          <ErrorMessage>
            {error || resource.error || records.error}
          </ErrorMessage>
        )}
        <div className="document-actions">
          {data?.can_order && data.admission_status === "ADMITTED" && (
            <button
              type="button"
              className="primary"
              disabled={!!action || busy}
              onClick={() => open({ kind: "ORDER" })}
            >
              Novi terapijski nalog
            </button>
          )}
          <button
            type="button"
            className="secondary"
            disabled={!!action || busy}
            onClick={refresh}
          >
            Osvježi terapiju
          </button>
        </div>
        {action && (
          <form className="card section-stack" onSubmit={save}>
            {action.kind === "ORDER" ? (
              <>
                <h3>Novi terapijski nalog</h3>
                <div className="form-grid">
                  <Field
                    name="medicine_search"
                    label="Pretraži lijek ili šifru"
                    value={search}
                    maxLength={200}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => {
                      setTerm(search.trim());
                      setMedicinePage(0);
                    }}
                  >
                    Pronađi lijek
                  </button>
                </div>
                {medicines.error && (
                  <ErrorMessage>{medicines.error}</ErrorMessage>
                )}
                <Field
                  name="medication_id"
                  label="Lijek iz šifrarnika"
                  required
                  value={medicine?.id ?? ""}
                  onChange={(e) =>
                    setMedicine(
                      medicines.data?.find((m) => m.id === e.target.value) ??
                        null,
                    )
                  }
                >
                  <option value="">Odaberite lijek</option>
                  {medicine &&
                    !medicines.data?.some((m) => m.id === medicine.id) && (
                      <option value={medicine.id}>
                        {medicine.name} · {medicine.packaging}
                      </option>
                    )}
                  {medicines.data?.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.catalog_code ? m.catalog_code + " · " : ""}
                      {m.name} · {m.strength} {m.packaging}
                    </option>
                  ))}
                </Field>
                <div className="document-actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!medicinePage}
                    onClick={() => setMedicinePage((n) => n - 1)}
                  >
                    Prethodni lijekovi
                  </button>
                  <span>Stranica {medicinePage + 1}</span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={
                      medicines.loading || (medicines.data?.length ?? 0) < 50
                    }
                    onClick={() => setMedicinePage((n) => n + 1)}
                  >
                    Sljedeći lijekovi
                  </button>
                </div>
                {medicine && (
                  <p className="note-text">
                    Odabrano: {medicine.name} · {medicine.active_ingredient} ·{" "}
                    {medicine.strength} {medicine.packaging}
                  </p>
                )}
                <Field
                  name="dose"
                  label="Propisana pojedinačna doza (količina i jedinica)"
                  required
                  maxLength={200}
                />
                <Field
                  name="route"
                  label="Put primjene"
                  required
                  maxLength={200}
                />
                <Field
                  name="instructions"
                  label="Uputa liječnika"
                  type="textarea"
                  maxLength={2000}
                />
                <h4>Planirana vremena pojedinih doza</h4>
                {slots.map((slot, index) => (
                  <div className="document-actions" key={index}>
                    <Field
                      name={"slot_" + index}
                      label={"Doza " + (index + 1)}
                      type="datetime-local"
                      required
                      value={slot}
                      onChange={(e) =>
                        setSlots((s) =>
                          s.map((x, i) => (i === index ? e.target.value : x)),
                        )
                      }
                    />
                    <button
                      type="button"
                      className="text-link"
                      disabled={slots.length === 1}
                      onClick={() =>
                        setSlots((s) => s.filter((_, i) => i !== index))
                      }
                    >
                      Ukloni dozu {index + 1}
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={slots.length >= 48}
                  onClick={() => setSlots((s) => [...s, ""])}
                >
                  Dodaj vrijeme doze
                </button>
                <p className="note-text">
                  Svaku dozu i vrijeme određuje liječnik. Nalog ne računa dozu,
                  ne provjerava interakcije i ne mijenja ambulantnu terapiju ili
                  recept. Za promjenu zaustavite nalog i izdajte novi.
                </p>
              </>
            ) : action.kind === "STOP" ? (
              <>
                <h3>
                  Zaustavi nalog · {action.order.medication_snapshot.name}
                </h3>
                <p>
                  {action.order.dose} · {action.order.route}
                </p>
                <Field
                  name="reason"
                  label="Razlog zaustavljanja"
                  required
                  minLength={5}
                  maxLength={1000}
                  type="textarea"
                />
                <p>
                  Nove primjene ovog naloga više neće biti moguće. Postojeći
                  zapisi ostaju sačuvani.
                </p>
              </>
            ) : (
              <>
                <h3>
                  {action.correct
                    ? "Ispravak zapisa primjene"
                    : "Evidentiraj ishod doze"}
                </h3>
                <p>
                  <strong>{action.order.medication_snapshot.name}</strong> ·{" "}
                  {action.order.medication_snapshot.strength}{" "}
                  {action.order.medication_snapshot.packaging}
                </p>
                <p>
                  Propisano: <strong>{action.order.dose}</strong> ·{" "}
                  {action.order.route}. Planirano:{" "}
                  {timeLabel(action.dose.scheduled_at)}
                </p>
                {action.order.instructions && (
                  <p>Uputa: {action.order.instructions}</p>
                )}
                <Field
                  name="outcome"
                  label="Ishod"
                  required
                  defaultValue={
                    action.correct ? action.dose.record?.outcome : "GIVEN"
                  }
                >
                  <option value="GIVEN">Primijenjeno</option>
                  <option value="NOT_GIVEN">Nije primijenjeno</option>
                </Field>
                <Field
                  name="actual_time"
                  label="Stvarni datum i vrijeme ishoda"
                  type="datetime-local"
                  step="1"
                  required
                  defaultValue={
                    action.correct && action.dose.record
                      ? zagrebInput(new Date(action.dose.record.actual_at))
                      : zagrebInput()
                  }
                />
                <Field
                  name="actual_dose"
                  label="Stvarno primijenjena doza i jedinica (samo za primijenjeno)"
                  maxLength={200}
                  defaultValue={
                    action.correct
                      ? (action.dose.record?.actual_dose ?? "")
                      : action.order.dose
                  }
                />
                <label>
                  <input name="patient_confirmed" type="checkbox" />{" "}
                  Provjerio/la sam identitet pacijenta i nalog prije primjene
                  (obvezno za primijenjeno).
                </label>
                <Field
                  name="note"
                  label="Napomena / razlog neprimjene ili odstupanja od doze"
                  type="textarea"
                  maxLength={2000}
                  defaultValue={action.correct ? action.dose.record?.note : ""}
                />
                {action.correct && (
                  <Field
                    name="correction_reason"
                    label="Razlog ispravka zapisa"
                    required
                    minLength={5}
                    maxLength={1000}
                    type="textarea"
                  />
                )}
              </>
            )}
            <div className="document-actions">
              <button
                className="primary"
                disabled={busy || (action.kind === "ORDER" && !medicine)}
              >
                Spremi terapijski zapis
              </button>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setAction(null);
                  setSaved((n) => n + 1);
                }}
              >
                Odustani od zapisa
              </button>
            </div>
          </form>
        )}
        {resource.loading ? (
          <p role="status">Učitavanje terapije…</p>
        ) : data?.orders.length ? (
          data.orders.map((order) => (
            <section className="card section-stack" key={order.id}>
              <div className="section-heading">
                <h3>{order.medication_snapshot.name}</h3>
                <span className="sample-stage">
                  {order.status === "ACTIVE"
                    ? "Aktivan nalog"
                    : order.status === "STOPPED"
                      ? "Zaustavljen nalog"
                      : "Zatvoren otpustom"}
                </span>
              </div>
              <p>
                {order.medication_snapshot.catalog_code} ·{" "}
                {order.medication_snapshot.strength}{" "}
                {order.medication_snapshot.packaging}
              </p>
              <p>
                <strong>{order.dose}</strong> · {order.route}
              </p>
              {order.instructions && (
                <p className="inpatient-note">{order.instructions}</p>
              )}
              <p className="note-text">
                Propisao/la: {order.author_name} · {timeLabel(order.created_at)}
              </p>
              {order.stop_reason && (
                <p>
                  {order.stop_reason} · {order.stop_author} ·{" "}
                  {order.stopped_at && timeLabel(order.stopped_at)}
                </p>
              )}
              <div className="document-actions">
                {data.can_order &&
                  order.status === "ACTIVE" &&
                  data.admission_status === "ADMITTED" && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={!!action || busy}
                      onClick={() => open({ kind: "STOP", order })}
                    >
                      Zaustavi nalog
                    </button>
                  )}
                <button
                  type="button"
                  className="text-link"
                  disabled={!!action || busy}
                  onClick={() => {
                    setHistory(order.id === history ? null : order.id);
                    setHistoryPage(0);
                  }}
                >
                  Povijest primjena i ispravaka
                </button>
              </div>
              <details open={data.orders.length === 1}>
                <summary>Planirane doze ({order.doses.length})</summary>
                <div className="section-stack spaced">
                  {order.doses.map((dose) => (
                    <section className="clinical-note" key={dose.id}>
                      <strong>{timeLabel(dose.scheduled_at)}</strong>
                      {dose.record ? (
                        <>
                          <p>
                            {dose.record.outcome === "GIVEN"
                              ? "Primijenjeno: " + dose.record.actual_dose
                              : "Nije primijenjeno"}{" "}
                            · {timeLabel(dose.record.actual_at)}
                          </p>
                          <p>
                            {dose.record.author_name}
                            {dose.record.corrects_record_id
                              ? " · ispravljeni zapis"
                              : ""}
                          </p>
                          {dose.record.note && <p>{dose.record.note}</p>}
                          {data.can_record && dose.record.can_correct && (
                            <button
                              type="button"
                              className="text-link"
                              disabled={!!action || busy}
                              onClick={() =>
                                open({
                                  kind: "RECORD",
                                  order,
                                  dose,
                                  correct: true,
                                })
                              }
                            >
                              Ispravi vlastiti zapis primjene
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          <p>
                            {order.status !== "ACTIVE"
                              ? "Doza nije evidentirana; nalog je zatvoren."
                              : new Date(dose.scheduled_at) < new Date()
                                ? "Ishod doze nije evidentiran."
                                : "Planirana doza"}
                          </p>
                          {data.can_record &&
                            order.status === "ACTIVE" &&
                            data.admission_status === "ADMITTED" && (
                              <button
                                type="button"
                                className="secondary"
                                disabled={!!action || busy}
                                onClick={() =>
                                  open({
                                    kind: "RECORD",
                                    order,
                                    dose,
                                    correct: false,
                                  })
                                }
                              >
                                Evidentiraj ishod doze
                              </button>
                            )}
                        </>
                      )}
                    </section>
                  ))}
                </div>
              </details>
              {history === order.id && (
                <section aria-label="Povijest terapijskih zapisa">
                  <h4>Povijest primjena i ispravaka</h4>
                  {records.loading ? (
                    <p>Učitavanje povijesti…</p>
                  ) : (
                    records.data?.records.map((record) => (
                      <div className="clinical-note spaced" key={record.id}>
                        <strong>
                          {record.outcome === "GIVEN"
                            ? "Primijenjeno: " + record.actual_dose
                            : "Nije primijenjeno"}
                          {record.superseded_by ? " · prethodna verzija" : ""}
                        </strong>
                        <p>
                          {timeLabel(record.actual_at)} · {record.author_name}
                        </p>
                        <p className="note-text">
                          Evidentirano: {timeLabel(record.created_at)} ·
                          Planirano: {timeLabel(record.scheduled_at)}
                        </p>
                        {record.note && <p>{record.note}</p>}
                        {record.correction_reason && (
                          <p>Razlog ispravka: {record.correction_reason}</p>
                        )}
                      </div>
                    ))
                  )}
                  {!records.loading && !records.data?.records.length && (
                    <p>Nema evidentiranih primjena.</p>
                  )}
                  <div className="document-actions">
                    <button
                      type="button"
                      className="secondary"
                      disabled={historyPage === 0 || !!action || busy}
                      onClick={() => setHistoryPage((n) => n - 1)}
                    >
                      Prethodni zapisi
                    </button>
                    <span>
                      Stranica {historyPage + 1} · {records.data?.total ?? 0}{" "}
                      zapisa
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      disabled={
                        (historyPage + 1) * 50 >= (records.data?.total ?? 0) ||
                        !!action ||
                        busy
                      }
                      onClick={() => setHistoryPage((n) => n + 1)}
                    >
                      Sljedeći zapisi
                    </button>
                  </div>
                </section>
              )}
            </section>
          ))
        ) : (
          <p>Nema bolničkih terapijskih naloga.</p>
        )}
        <div className="document-actions">
          <button
            type="button"
            className="secondary"
            disabled={page === 0 || !!action || busy}
            onClick={() => setPage((n) => n - 1)}
          >
            Prethodni nalozi
          </button>
          <span>
            Stranica {page + 1} · {data?.total ?? 0} naloga
          </span>
          <button
            type="button"
            className="secondary"
            disabled={(page + 1) * 20 >= (data?.total ?? 0) || !!action || busy}
            onClick={() => setPage((n) => n + 1)}
          >
            Sljedeći nalozi
          </button>
        </div>
      </div>
    </Modal>
  );
}
