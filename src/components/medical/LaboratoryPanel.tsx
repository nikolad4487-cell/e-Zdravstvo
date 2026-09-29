import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  getLaboratory,
  getLaboratories,
  orderLaboratory,
  labStatus,
  publishLabResult,
} from "../../services/laboratory";
import {
  labStatusLabels,
  labFlagLabels,
  type LabOrder,
  type LabResult,
  type LabMode,
} from "../../types/laboratory";
import type { Json } from "../../lib/database.types";
import { Field, values } from "../ui/Fields";
import { Modal } from "../ui/Modal";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel, readableError } from "../../utils/format";

export function LaboratoryPanel({
  mode,
  patientId,
  canOrder = false,
}: {
  mode: LabMode;
  patientId?: string;
  canOrder?: boolean;
}) {
  const [page, setPage] = useState(0),
    [ordering, setOrdering] = useState(false),
    [publish, setPublish] = useState<LabOrder | null>(null),
    [selected, setSelected] = useState<LabOrder | null>(null),
    [transition, setTransition] = useState<{
      order: LabOrder;
      status: "IN_PROGRESS" | "CANCELLED";
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [trend, setTrend] = useState("");
  const resource = useResource(
    () => getLaboratory(mode, patientId, page),
    [mode, patientId, page].join(":"),
  );
  useScheduleRefresh(resource.refresh);
  useEffect(() => {
    if (resource.data)
      setSelected((current) =>
        current
          ? (resource.data?.find((o) => o.id === current.id) ?? null)
          : null,
      );
  }, [resource.data]);
  const points = (resource.data ?? [])
    .flatMap((o) =>
      o.results
        .filter((r) => !r.superseded_by)
        .flatMap((r) =>
          r.parameters.map((p) => ({
            ...p,
            date: r.sampled_at,
            order: o.number,
          })),
        ),
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const options = [
    ...new Map(
      points.map((p) => [
        p.code + "|" + p.unit,
        { code: p.code, name: p.name, unit: p.unit },
      ]),
    ).entries(),
  ];
  async function update(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!transition) return;
    setBusy(true);
    setError("");
    try {
      await labStatus(
        transition.order.id,
        transition.order.version,
        transition.status,
        values(e.currentTarget).reason,
      );
      setTransition(null);
      setSuccess("Status narudžbe je ažuriran.");
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            {mode === "LAB"
              ? "e-ZDRAVSTVO LABORATORIJ"
              : "LABORATORIJSKA DIJAGNOSTIKA"}
          </div>
          <h1>
            {mode === "PERSONAL" ? "Moji laboratorijski nalazi" : "Laboratorij"}
          </h1>
          <p>
            {mode === "LAB"
              ? "Obrada zaprimljenih narudžbi i objava rezultata."
              : "Narudžbe, rezultati i povijest ispravaka."}
          </p>
        </div>
        {canOrder && patientId && (
          <button className="primary" onClick={() => setOrdering(true)}>
            Nova laboratorijska narudžba
          </button>
        )}
        {mode === "CARE" && !patientId && (
          <Link className="primary" to="/ordinacija/pacijenti">
            Odaberi pacijenta za narudžbu
          </Link>
        )}
      </div>
      <div className="section-heading">
        <p className="muted">Stranica {page + 1} · do 50 narudžbi</p>
        <button
          className="secondary"
          disabled={resource.loading}
          onClick={resource.refresh}
        >
          Osvježi laboratorij
        </button>
      </div>
      {success && (
        <p className="feedback success" role="status">
          {success}
        </p>
      )}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje laboratorija…</p>
      ) : resource.data?.length ? (
        <div className="section-stack">
          {resource.data.map((o) => (
            <section className="card" key={o.id}>
              <div className="section-heading">
                <h2>{o.number}</h2>
                <span
                  className={
                    "status-text " +
                    (o.status === "CANCELLED" ? "status-muted" : "")
                  }
                >
                  {labStatusLabels[o.status]}
                </span>
              </div>
              <p>
                <strong>{o.patient_name}</strong> · {o.patient_number} ·{" "}
                {dateLabel(o.birth_date)}
              </p>
              <p>{o.requested_tests}</p>
              <p className="note-text">
                {o.laboratory_name} · {o.doctor_name} ·{" "}
                {dateLabel(o.created_at)}
                {o.priority === "URGENT" ? " · HITNO" : ""}
              </p>
              {o.cancellation_reason && (
                <p>Otkazano: {o.cancellation_reason}</p>
              )}
              <div className="document-actions">
                <button className="secondary" onClick={() => setSelected(o)}>
                  Otvori narudžbu i rezultate
                </button>
                {o.can_publish && o.status === "ORDERED" && (
                  <button
                    className="primary"
                    onClick={() => {
                      setError("");
                      setTransition({ order: o, status: "IN_PROGRESS" });
                    }}
                  >
                    Preuzmi u obradu
                  </button>
                )}
                {o.can_publish &&
                  ["IN_PROGRESS", "COMPLETED"].includes(o.status) && (
                    <button className="primary" onClick={() => setPublish(o)}>
                      {o.status === "COMPLETED"
                        ? "Ispravi nalaz"
                        : "Unesi rezultate"}
                    </button>
                  )}
                {(o.can_publish || o.can_cancel) &&
                  ["ORDERED", "IN_PROGRESS"].includes(o.status) && (
                    <button
                      className="text-link"
                      onClick={() => {
                        setError("");
                        setTransition({ order: o, status: "CANCELLED" });
                      }}
                    >
                      Otkaži narudžbu
                    </button>
                  )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="card empty-state">
          Još nema laboratorijskih narudžbi.
        </section>
      )}
      <div className="document-actions spaced">
        <button
          className="secondary"
          disabled={page === 0 || resource.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodna
        </button>
        <button
          className="secondary"
          disabled={resource.loading || resource.data?.length !== 50}
          onClick={() => setPage(page + 1)}
        >
          Sljedeća
        </button>
      </div>
      {(patientId || mode === "PERSONAL") && options.length > 0 && (
        <section className="card spaced">
          <h2>Rezultati kroz vrijeme</h2>
          <p className="muted">
            Usporedba aktualnih verzija nalaza na ovoj stranici, za istu šifru i
            jedinicu.
          </p>
          <label className="field">
            <span>Parametar</span>
            <select value={trend} onChange={(e) => setTrend(e.target.value)}>
              <option value="">Odaberite parametar</option>
              {options.map(([key, p]) => (
                <option key={key} value={key}>
                  {p.code} · {p.name} ({p.unit})
                </option>
              ))}
            </select>
          </label>
          {trend && (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Uzorkovanje</th>
                    <th>Rezultat</th>
                    <th>Referentni interval</th>
                    <th>Oznaka</th>
                  </tr>
                </thead>
                <tbody>
                  {points
                    .filter((p) => p.code + "|" + p.unit === trend)
                    .map((p) => (
                      <tr key={p.id}>
                        <td>{dateLabel(p.date)}</td>
                        <td>
                          {p.value} {p.unit}
                        </td>
                        <td>
                          {p.reference_low ?? "—"} – {p.reference_high ?? "—"}
                        </td>
                        <td>
                          {p.flag ? labFlagLabels[p.flag] : "Bez intervala"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {ordering && patientId && (
        <LabOrderEditor
          patientId={patientId}
          onClose={() => setOrdering(false)}
          onSaved={() => {
            setOrdering(false);
            setSuccess("Laboratorijska narudžba je spremljena.");
            resource.refresh();
          }}
        />
      )}
      {publish && (
        <LabResultEditor
          order={publish}
          onClose={() => setPublish(null)}
          onSaved={() => {
            setPublish(null);
            setSuccess("Nalaz je objavljen i dostupan pacijentu.");
            resource.refresh();
          }}
        />
      )}
      {selected && (
        <Modal title={selected.number} wide onClose={() => setSelected(null)}>
          <div className="modal-content">
            <h3>{selected.patient_name}</h3>
            <p>
              {selected.laboratory_name} · {selected.doctor_name}
            </p>
            <p>
              <strong>Tražene pretrage:</strong> {selected.requested_tests}
            </p>
            <p>
              <strong>Kliničko pitanje:</strong>{" "}
              {selected.clinical_question || "Nije navedeno"}
            </p>
            {selected.results.length === 0 ? (
              <p>Rezultati još nisu objavljeni.</p>
            ) : (
              selected.results.map((r) => (
                <LabResultView key={r.id} result={r} />
              ))
            )}
          </div>
        </Modal>
      )}
      {transition && (
        <Modal
          title="Status laboratorijske narudžbe"
          busy={busy}
          onClose={() => setTransition(null)}
        >
          <form onSubmit={update}>
            <p>
              {transition.order.number} · {transition.order.patient_name}
            </p>
            <p>
              {transition.status === "IN_PROGRESS"
                ? "Preuzeti narudžbu u obradu?"
                : "Otkazati narudžbu? Zapis će ostati u evidenciji."}
            </p>
            {transition.status === "CANCELLED" && (
              <Field
                name="reason"
                label="Razlog otkazivanja"
                type="textarea"
                required
                minLength={5}
                maxLength={500}
              />
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                Potvrdi
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function LabResultView({ result: r }: { result: LabResult }) {
  return (
    <section className="lab-result">
      <div className="section-heading">
        <h3>Nalaz · verzija {r.version}</h3>
        <span>
          {r.superseded_by ? "Zamijenjeno novijom verzijom" : "Aktualni nalaz"}
        </span>
      </div>
      <p>
        Uzorkovanje: {dateLabel(r.sampled_at)} · Objavljeno:{" "}
        {dateLabel(r.reported_at)} · {r.author}
      </p>
      {r.correction_reason && <p>Razlog ispravka: {r.correction_reason}</p>}
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Parametar</th>
              <th>Vrijednost</th>
              <th>Jedinica</th>
              <th>Referentni interval</th>
              <th>Oznaka</th>
            </tr>
          </thead>
          <tbody>
            {r.parameters.map((p) => (
              <tr
                key={p.id}
                className={p.flag === "CRITICAL" ? "lab-critical" : ""}
              >
                <td>
                  {p.code} · {p.name}
                </td>
                <td>
                  <strong>{p.value}</strong>
                </td>
                <td>{p.unit}</td>
                <td>
                  {p.reference_low ?? "—"} – {p.reference_high ?? "—"}
                </td>
                <td>{p.flag ? labFlagLabels[p.flag] : "Bez intervala"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {r.summary && <p className="clinical-note">{r.summary}</p>}
    </section>
  );
}
function LabOrderEditor({
  patientId,
  onClose,
  onSaved,
}: {
  patientId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const labs = useResource(getLaboratories, "labs"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [requestId] = useState(() => crypto.randomUUID());
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = values(e.currentTarget);
    try {
      await orderLaboratory(patientId, data, requestId);
      onSaved();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Nova laboratorijska narudžba" busy={busy} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <Field name="laboratory_institution_id" label="Laboratorij" required>
            <option value="">Odaberite laboratorij</option>
            {labs.data?.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Field>
          <Field name="priority" label="Prioritet">
            <option value="REGULAR">Redovno</option>
            <option value="URGENT">Hitno</option>
          </Field>
          <Field
            name="requested_tests"
            label="Tražene pretrage"
            type="textarea"
            required
            minLength={2}
            maxLength={2000}
          />
          <Field
            name="clinical_question"
            label="Kliničko pitanje za laboratorij"
            type="textarea"
            maxLength={2000}
          />
        </div>
        <p className="signature-note">
          Laboratorij dobiva podatke ove narudžbe i identitet pacijenta. Ne
          dobiva pristup cijelom kartonu.
        </p>
        {labs.data?.length === 0 && (
          <p>Nema ustanove s aktivnim laboratorijskim tehničarem.</p>
        )}
        {(error || labs.error) && (
          <ErrorMessage>{error || labs.error}</ErrorMessage>
        )}
        <div className="modal-actions">
          <button
            className="primary"
            disabled={busy || labs.loading || !labs.data?.length}
          >
            Pošalji u laboratorij
          </button>
        </div>
      </form>
    </Modal>
  );
}
function LabResultEditor({
  order,
  onClose,
  onSaved,
}: {
  order: LabOrder;
  onClose: () => void;
  onSaved: () => void;
}) {
  const previous = order.results.find((r) => !r.superseded_by),
    [rows, setRows] = useState(previous?.parameters.map((_, i) => i) ?? [0]),
    [next, setNext] = useState(previous?.parameters.length ?? 1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [draft, setDraft] = useState<Json | null>(null);
  function review(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = values(e.currentTarget);
    setDraft({
      sampled_at: new Date(data.sampled_at).toISOString(),
      summary: data.summary,
      correction_reason: data.correction_reason ?? "",
      parameters: rows.map((i) => ({
        code: data["code_" + i],
        name: data["name_" + i],
        value: data["value_" + i],
        unit: data["unit_" + i],
        reference_low: data["low_" + i],
        reference_high: data["high_" + i],
        critical: data["critical_" + i] === "true",
      })),
    });
  }
  async function publish() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await publishLabResult(order.id, previous?.id ?? null, draft);
      onSaved();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const localSample = previous
    ? new Date(
        new Date(previous.sampled_at).getTime() -
          new Date(previous.sampled_at).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
        .toISOString()
        .slice(0, 16);
  return (
    <Modal
      title={
        previous
          ? "Ispravak laboratorijskog nalaza"
          : "Novi laboratorijski nalaz"
      }
      wide
      busy={busy}
      onClose={onClose}
    >
      <form onSubmit={review} hidden={!!draft}>
        <p>
          {order.number} · {order.patient_name}
        </p>
        <Field
          name="sampled_at"
          label="Datum uzorkovanja (lokalno vrijeme)"
          type="datetime-local"
          required
          defaultValue={localSample}
        />
        {rows.map((i, index) => {
          const p = previous?.parameters[i];
          return (
            <section className="prescription-line" key={i}>
              <div className="section-heading">
                <h3>Parametar {index + 1}</h3>
                {rows.length > 1 && (
                  <button
                    className="text-link"
                    type="button"
                    onClick={() => setRows(rows.filter((n) => n !== i))}
                  >
                    Ukloni
                  </button>
                )}
              </div>
              <div className="form-grid">
                <Field
                  name={"code_" + i}
                  label="Šifra parametra"
                  required
                  maxLength={40}
                  defaultValue={p?.code}
                />
                <Field
                  name={"name_" + i}
                  label="Naziv parametra"
                  required
                  maxLength={150}
                  defaultValue={p?.name}
                />
                <Field
                  name={"value_" + i}
                  label="Izmjerena vrijednost"
                  type="number"
                  step="any"
                  required
                  min={-1e12}
                  max={1e12}
                  defaultValue={p?.value}
                />
                <Field
                  name={"unit_" + i}
                  label="Jedinica"
                  maxLength={50}
                  defaultValue={p?.unit}
                />
                <Field
                  name={"low_" + i}
                  label="Referentna donja granica"
                  type="number"
                  step="any"
                  defaultValue={p?.reference_low ?? undefined}
                />
                <Field
                  name={"high_" + i}
                  label="Referentna gornja granica"
                  type="number"
                  step="any"
                  defaultValue={p?.reference_high ?? undefined}
                />
                <label>
                  <input
                    type="checkbox"
                    name={"critical_" + i}
                    value="true"
                    defaultChecked={p?.flag === "CRITICAL"}
                  />{" "}
                  Označi kao kritičan rezultat
                </label>
              </div>
            </section>
          );
        })}
        <button
          type="button"
          className="secondary"
          disabled={rows.length >= 100}
          onClick={() => {
            setRows([...rows, next]);
            setNext(next + 1);
          }}
        >
          Dodaj parametar
        </button>
        <div className="form-grid spaced">
          <Field
            name="summary"
            label="Zaključak / napomena laboratorija"
            type="textarea"
            maxLength={4000}
            defaultValue={previous?.summary}
          />
          {previous && (
            <Field
              name="correction_reason"
              label="Razlog ispravka"
              type="textarea"
              required
              minLength={5}
              maxLength={1000}
            />
          )}
        </div>
        <p className="signature-note">
          Referentne intervale unosi laboratorij. Bez intervala ne prikazuje se
          oznaka urednosti.
        </p>
        <div className="modal-actions">
          <button className="primary">Pregledaj prije objave</button>
        </div>
      </form>
      {draft && (
        <div className="modal-content">
          <p>
            Objaviti nalaz za {order.patient_name}? Rezultat će odmah biti
            vidljiv pacijentu i ovlaštenom liječniku.
          </p>
          {previous && (
            <p>Izvorna verzija ostaje dostupna u povijesti ispravaka.</p>
          )}
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <div className="modal-actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Natrag na uređivanje
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void publish()}
            >
              {busy ? "Objava…" : "Potvrdi objavu"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
