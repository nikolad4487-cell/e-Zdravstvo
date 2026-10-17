import { MedicalCodePicker } from "./MedicalCodePicker";
import { LaboratoryParameterFields } from "./LaboratoryParameterFields";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import { useAuth } from "../../hooks/useAuth";
import { CriticalAcknowledgement } from "./CriticalAcknowledgement";
import { LaboratoryTrends } from "./LaboratoryTrends";
import {
  getLaboratory,
  getLaboratories,
  orderLaboratory,
  labStatus,
  publishLabResult,
  type LaboratoryFilters,
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
import { Pagination } from "../ui/Pagination";
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
    [draftFilters, setDraftFilters] = useState<LaboratoryFilters>({}),
    [filters, setFilters] = useState<LaboratoryFilters>({}),
    [filterError, setFilterError] = useState(""),
    [ordering, setOrdering] = useState(false),
    [publish, setPublish] = useState<LabOrder | null>(null),
    [selected, setSelected] = useState<LabOrder | null>(null),
    [transition, setTransition] = useState<{
      order: LabOrder;
      status: "IN_PROGRESS" | "CANCELLED";
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const resource = useResource(
    () => getLaboratory(mode, patientId, page, filters),
    JSON.stringify([mode, patientId, page, filters]),
  );
  useScheduleRefresh(resource.refresh);
  useEffect(() => setPage(0), [mode, patientId]);
  function search(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (
      draftFilters.from &&
      draftFilters.to &&
      draftFilters.from > draftFilters.to
    ) {
      setFilterError("Datum do mora biti jednak ili kasniji od datuma od.");
      return;
    }
    setFilterError("");
    setFilters({ ...draftFilters, search: draftFilters.search?.trim() });
    setPage(0);
    resource.refresh();
  }
  function clearFilters() {
    setDraftFilters({});
    setFilters({});
    setFilterError("");
    setPage(0);
    resource.refresh();
  }
  useEffect(() => {
    if (resource.data)
      setSelected((current) =>
        current
          ? (resource.data?.find((o) => o.id === current.id) ?? null)
          : null,
      );
  }, [resource.data]);
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
      <form
        className="card spaced"
        onSubmit={search}
        aria-label="Pretraga laboratorijskih narudžbi"
      >
        <div className="form-grid">
          <Field
            label="Pretraži narudžbe"
            name="lab_search"
            type="search"
            maxLength={200}
            placeholder="Pacijent, broj narudžbe, pretraga ili laboratorij"
            value={draftFilters.search ?? ""}
            onChange={(e) =>
              setDraftFilters({ ...draftFilters, search: e.target.value })
            }
          />
          <Field
            label="Status narudžbe"
            name="lab_status"
            value={draftFilters.status ?? ""}
            onChange={(e) =>
              setDraftFilters({
                ...draftFilters,
                status: e.target.value as LaboratoryFilters["status"],
              })
            }
          >
            <option value="">Svi statusi</option>
            {Object.entries(labStatusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Field>
          <Field
            label="Hitnost"
            name="lab_priority"
            value={draftFilters.priority ?? ""}
            onChange={(e) =>
              setDraftFilters({
                ...draftFilters,
                priority: e.target.value as LaboratoryFilters["priority"],
              })
            }
          >
            <option value="">Sve narudžbe</option>
            <option value="REGULAR">Redovno</option>
            <option value="URGENT">Hitno</option>
          </Field>
          <Field
            label="Naručeno od"
            name="lab_from"
            type="date"
            value={draftFilters.from ?? ""}
            onChange={(e) =>
              setDraftFilters({ ...draftFilters, from: e.target.value })
            }
          />
          <Field
            label="Naručeno do"
            name="lab_to"
            type="date"
            min={draftFilters.from}
            value={draftFilters.to ?? ""}
            onChange={(e) =>
              setDraftFilters({ ...draftFilters, to: e.target.value })
            }
          />
        </div>
        <div className="document-actions spaced">
          <button className="primary" disabled={resource.loading}>
            Pretraži
          </button>
          <button
            className="secondary"
            type="button"
            onClick={clearFilters}
            disabled={resource.loading}
          >
            Poništi filtre
          </button>
        </div>
        <p className="note-text">
          Pretražuje se cijela dostupna povijest narudžbi. Datumi se odnose na
          dan naručivanja u hrvatskom vremenu.
        </p>
        {filterError && <ErrorMessage>{filterError}</ErrorMessage>}
      </form>
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
              {o.catalog_details?.specimens?.length ? (
                <p>
                  Uzorci:{" "}
                  {o.catalog_details.specimens
                    .map((s) => s.code + " · " + s.name)
                    .join(", ")}
                </p>
              ) : null}
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
                {o.can_publish &&
                  o.status === "ORDERED" &&
                  (!o.sample_status || o.sample_status === "EXPECTED") && (
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
          Nema narudžbi za odabrane filtre na ovoj stranici.
        </section>
      )}
      <Pagination
        page={page}
        size={resource.data?.length ?? 0}
        loading={resource.loading}
        onChange={setPage}
      />
      {(mode === "PERSONAL" || (mode === "CARE" && patientId)) && (
        <LaboratoryTrends patientId={patientId} />
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
                <LabResultView key={r.id} result={r} mode={mode} />
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
export function LabResultView({
  result: r,
  mode,
}: {
  result: LabResult;
  mode: LabMode;
}) {
  const { roles } = useAuth();
  const [downloading, setDownloading] = useState(false),
    [downloadError, setDownloadError] = useState("");
  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      const { downloadLabResult } = await import("../../services/reports");
      await downloadLabResult(r.id);
    } catch (e) {
      setDownloadError(readableError(e));
    } finally {
      setDownloading(false);
    }
  }
  return (
    <section className="lab-result">
      {mode !== "LAB" &&
        !r.superseded_by &&
        r.parameters.some((p) => p.flag === "CRITICAL") && (
          <CriticalAcknowledgement
            resultId={r.id}
            canAcknowledge={mode === "CARE" && roles.includes("DOCTOR")}
          />
        )}
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
                  <strong>{p.value ?? p.text_value}</strong>
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
      {downloadError && <ErrorMessage>{downloadError}</ErrorMessage>}
      <button
        className="primary"
        disabled={downloading}
        onClick={() => void download()}
      >
        {downloading ? "Priprema…" : "Preuzmi laboratorijski nalaz PDF"}
      </button>
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
  const [catalogCodes, setCatalogCodes] = useState<string[]>([]),
    [specimenCodes, setSpecimenCodes] = useState<string[]>([]);
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
      await orderLaboratory(
        patientId,
        {
          ...data,
          catalog_order_codes: catalogCodes,
          specimen_codes: specimenCodes,
        },
        requestId,
      );
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
          <MedicalCodePicker
            list="2.2.30"
            name="catalog_order_codes"
            label="Pretrage za naručivanje (CEZIH)"
            multiple
            onSelected={(items) => setCatalogCodes(items.map((c) => c.code))}
          />
          <MedicalCodePicker
            list="2.2.18"
            name="specimen_codes"
            label="Vrste uzoraka (CEZIH)"
            multiple
            onSelected={(items) => setSpecimenCodes(items.map((c) => c.code))}
          />
          {!catalogCodes.length && (
            <Field
              name="requested_tests"
              label="Tražene pretrage (slobodan unos)"
              type="textarea"
              required
              minLength={2}
              maxLength={2000}
            />
          )}
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
export function LabResultEditor({
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
      expected_order_version: order.version,
      sampled_at: new Date(data.sampled_at).toISOString(),
      summary: data.summary,
      correction_reason: data.correction_reason ?? "",
      parameters: rows.map((i) => ({
        code: data["code_" + i],
        name: data["name_" + i],
        value: data["value_" + i],
        unit: data["unit_" + i],
        catalog_list: data["catalog_list_" + i],
        value_kind: data["value_kind_" + i],
        text_value: data["text_value_" + i],
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
  const sampleTime = new Date(
    previous?.sampled_at ?? order.sample_collected_at ?? Date.now(),
  );
  const localSample = new Date(
    sampleTime.getTime() - sampleTime.getTimezoneOffset() * 60000,
  )
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
              <LaboratoryParameterFields index={i} previous={p} />
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
