import { LaboratorySamples } from "./LaboratorySamples";
import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import { Field, values } from "../ui/Fields";
import { Modal } from "../ui/Modal";
import { ErrorMessage } from "../ui/Feedback";
import {
  LaboratoryPanel,
  LabResultEditor,
  LabResultView,
} from "./LaboratoryPanel";
import { getLaboratory } from "../../services/laboratory";
import {
  laboratoryWorklist,
  advanceLaboratoryWorkflow,
  sampleStageLabels,
  type SampleStage,
  type LaboratoryWorkItem,
  type WorklistFilters,
} from "../../services/laboratoryWorklist";
import type { LabOrder } from "../../types/laboratory";
import { zagrebDate, zagrebTime } from "../../utils/calendar";
import { dateLabel, readableError } from "../../utils/format";
const nextActions: Partial<
  Record<SampleStage, { stage: SampleStage; label: string }>
> = {
  EXPECTED: { stage: "ARRIVED", label: "Zaprimi pacijenta" },
  ARRIVED: { stage: "COLLECTED", label: "Evidentiraj uzorak" },
  COLLECTED: { stage: "PROCESSING", label: "Pokreni obradu" },
  RECOLLECT: { stage: "COLLECTED", label: "Evidentiraj novi uzorak" },
};
export function LaboratoryWorkspace() {
  const [tab, setTab] = useState("DAY");
  return (
    <>
      <div
        className="lab-work-tabs"
        role="group"
        aria-label="Prikaz laboratorija"
      >
        <button
          type="button"
          className={tab === "DAY" ? "active" : ""}
          aria-pressed={tab === "DAY"}
          onClick={() => setTab("DAY")}
        >
          Dnevni raspored i uzorci
        </button>
        <button
          type="button"
          className={tab === "ORDERS" ? "active" : ""}
          aria-pressed={tab === "ORDERS"}
          onClick={() => setTab("ORDERS")}
        >
          Sve narudžbe i nalazi
        </button>
      </div>
      {tab === "DAY" ? <LaboratoryWorklist /> : <LaboratoryPanel mode="LAB" />}
    </>
  );
}
export function LaboratoryWorklist() {
  const [sampleOrder, setSampleOrder] = useState<string | null>(null);
  const [filters, setFilters] = useState<WorklistFilters>({
      day: zagrebDate(),
      institution: "",
      search: "",
      stage: "",
    }),
    [draft, setDraft] = useState(filters),
    [page, setPage] = useState(0),
    [change, setChange] = useState<{
      item: LaboratoryWorkItem;
      stage: SampleStage;
    } | null>(null),
    [detail, setDetail] = useState<LaboratoryWorkItem | null>(null),
    [result, setResult] = useState<{ order: LabOrder; edit: boolean } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const resource = useResource(
    () => laboratoryWorklist(filters, page),
    JSON.stringify([filters, page]),
  );
  useScheduleRefresh(resource.refresh);
  function filter(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFilters({ ...draft });
    setPage(0);
    setError("");
  }
  async function advance(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!change) return;
    setBusy(true);
    setError("");
    try {
      await advanceLaboratoryWorkflow(
        change.item,
        change.stage,
        values(e.currentTarget).reason ?? "",
      );
      setSuccess(sampleStageLabels[change.stage] + ".");
      setChange(null);
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function openResult(item: LaboratoryWorkItem, edit: boolean) {
    if (!item.order_id) return;
    setBusy(true);
    setError("");
    try {
      const orders = await getLaboratory("LAB", undefined, 0, {
        search: item.number,
      });
      const order = orders.find((o) => o.id === item.order_id);
      if (!order)
        throw Error("Zahtjev više nije dostupan. Osvježite raspored.");
      setResult({ order, edit });
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const total = resource.data?.total ?? 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">RAD LABORATORIJA</div>
          <h1>Dnevni raspored i uzorci</h1>
          <p>Dolazak pacijenata, uzimanje uzoraka i tijek obrade.</p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={resource.loading || busy}
          onClick={resource.refresh}
        >
          Osvježi raspored
        </button>
      </div>
      <form
        className="card spaced"
        aria-label="Filtri dnevnog laboratorija"
        onSubmit={filter}
      >
        <div className="form-grid">
          <Field
            name="work_day"
            label="Datum rasporeda"
            type="date"
            required
            value={draft.day}
            onChange={(e) => setDraft({ ...draft, day: e.target.value })}
          />
          <Field
            name="work_institution"
            label="Laboratorijska ustanova"
            value={draft.institution}
            onChange={(e) =>
              setDraft({ ...draft, institution: e.target.value })
            }
          >
            <option value="">Sve moje ustanove</option>
            {resource.data?.institutions.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Field>
          <Field
            name="work_search"
            label="Pacijent ili pretraga"
            type="search"
            maxLength={200}
            placeholder="Ime, broj pacijenta, zahtjev ili pretraga"
            value={draft.search}
            onChange={(e) => setDraft({ ...draft, search: e.target.value })}
          />
          <Field
            name="work_stage"
            label="Status uzorka / dolaska"
            value={draft.stage}
            onChange={(e) => setDraft({ ...draft, stage: e.target.value })}
          >
            <option value="">Svi statusi</option>
            {Object.entries(sampleStageLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Field>
        </div>
        <div className="document-actions spaced">
          <button className="primary" disabled={resource.loading || busy}>
            Prikaži raspored
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const f = {
                day: zagrebDate(),
                institution: "",
                search: "",
                stage: "",
              };
              setDraft(f);
              setFilters(f);
              setPage(0);
            }}
          >
            Danas
          </button>
        </div>
        <p className="note-text">
          Vrijeme termina prikazano je prema hrvatskom vremenu. Zahtjevi bez
          termina prikazuju se prema danu izrade; stariju obradu pronađite u
          „Sve narudžbe i nalazi”.
        </p>
      </form>
      <div className="lab-work-counts" aria-label="Pregled dana">
        {(
          [
            "EXPECTED",
            "ARRIVED",
            "COLLECTED",
            "PROCESSING",
            "RECOLLECT",
            "COMPLETED",
          ] as const
        ).map((stage) => (
          <div className="card" key={stage}>
            <strong>
              {resource.loading ? "—" : (resource.data?.counts[stage] ?? 0)}
            </strong>
            <span>{sampleStageLabels[stage]}</span>
          </div>
        ))}
      </div>
      {success && (
        <p role="status" className="feedback success">
          {success}
        </p>
      )}
      {(resource.error || (error && !change)) && (
        <ErrorMessage>{resource.error || error}</ErrorMessage>
      )}
      <div className="section-heading">
        <h2>{dateLabel(filters.day)}</h2>
        <span>{total} stavki</span>
      </div>
      {resource.loading ? (
        <p role="status">Učitavanje dnevnog rasporeda…</p>
      ) : resource.data?.items.length ? (
        <ol className="lab-work-list">
          {resource.data.items.map((item) => {
            const next = nextActions[item.stage];
            return (
              <li
                className="card lab-work-row"
                key={item.source_kind + item.source_id}
              >
                <div className="lab-work-time">
                  <strong>
                    {item.starts_at
                      ? zagrebTime(item.starts_at)
                      : "Bez termina"}
                  </strong>
                  {item.priority && (
                    <span className="status-text">Prioritetno</span>
                  )}
                </div>
                <div className="lab-work-patient">
                  <h3>{item.patient_name}</h3>
                  <p className="note-text">
                    {item.patient_number} · {item.institution_name}
                  </p>
                  <p>{item.requested_tests}</p>
                  {item.specimens.length > 0 && (
                    <p className="note-text">
                      Uzorci: {item.specimens.map((s) => s.name).join(", ")}
                    </p>
                  )}
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setDetail(item)}
                  >
                    Detalji i povijest
                  </button>
                </div>
                <div className="lab-work-stage">
                  <span
                    className={
                      "sample-stage sample-stage-" + item.stage.toLowerCase()
                    }
                  >
                    {sampleStageLabels[item.stage]}
                  </span>
                  {item.attempt > 0 && (
                    <small>Uzorkovanje: {item.attempt}.</small>
                  )}
                  {item.sample_note && <small>{item.sample_note}</small>}
                </div>
                <div className="lab-work-actions">
                  {item.order_id && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => setSampleOrder(item.order_id)}
                    >
                      Uzorci i oznake
                    </button>
                  )}
                  {next && (
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setChange({ item, stage: next.stage });
                      }}
                    >
                      {next.label}
                    </button>
                  )}
                  {item.stage === "PROCESSING" && (
                    <button
                      type="button"
                      className="primary"
                      disabled={busy}
                      onClick={() => openResult(item, true)}
                    >
                      Unesi rezultate
                    </button>
                  )}
                  {item.stage === "COMPLETED" && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => openResult(item, false)}
                    >
                      Otvori nalaz
                    </button>
                  )}
                  {["COLLECTED", "PROCESSING"].includes(item.stage) && (
                    <button
                      type="button"
                      className="text-link"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setChange({ item, stage: "RECOLLECT" });
                      }}
                    >
                      Zatraži novi uzorak
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <section className="card empty-state">
          Nema stavki za odabrani dan i filtre.
        </section>
      )}
      <div className="document-actions spaced">
        <button
          type="button"
          className="secondary"
          disabled={page === 0 || resource.loading || busy}
          onClick={() => setPage(page - 1)}
        >
          Prethodna stranica
        </button>
        <span>Stranica {page + 1}</span>
        <button
          type="button"
          className="secondary"
          disabled={(page + 1) * 50 >= total || resource.loading || busy}
          onClick={() => setPage(page + 1)}
        >
          Sljedeća stranica
        </button>
      </div>
      {sampleOrder && (
        <LaboratorySamples
          orderId={sampleOrder}
          onClose={() => setSampleOrder(null)}
          onChanged={resource.refresh}
        />
      )}
      {change && (
        <Modal
          title={sampleStageLabels[change.stage]}
          busy={busy}
          onClose={() => {
            setChange(null);
            setError("");
          }}
        >
          <form onSubmit={advance}>
            <p>
              <strong>{change.item.patient_name}</strong> ·{" "}
              {change.item.patient_number}
            </p>
            <p>{change.item.requested_tests}</p>
            <p>
              {change.stage === "COLLECTED"
                ? "Potvrdite da je uzorak uzet. Vrijeme uzorkovanja zabilježit će se uz ovu promjenu."
                : change.stage === "ARRIVED"
                  ? "Potvrdite dolazak pacijenta. Narudžba termina povezat će se s laboratorijskim zahtjevom."
                  : change.stage === "PROCESSING"
                    ? "Potvrdite početak obrade zaprimljenog uzorka."
                    : "Navedite zašto je potrebno ponovno uzorkovanje. Prethodni zapis ostaje u povijesti."}
            </p>
            {change.stage === "RECOLLECT" && (
              <Field
                name="reason"
                label="Razlog ponovnog uzorkovanja"
                type="textarea"
                required
                minLength={5}
                maxLength={500}
              />
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              {error && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    setChange(null);
                    resource.refresh();
                  }}
                >
                  Osvježi prikaz
                </button>
              )}
              <button className="primary" disabled={busy}>
                {busy ? "Spremanje…" : "Potvrdi promjenu"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {detail && (
        <Modal
          title="Detalji laboratorijske narudžbe"
          wide
          onClose={() => setDetail(null)}
        >
          <div className="modal-content">
            <h3>{detail.patient_name}</h3>
            <p>
              {detail.number} · {detail.patient_number}
            </p>
            <p>
              {detail.service_name} ·{" "}
              {detail.location || detail.institution_name}
            </p>
            <p>Uputio/la: {detail.doctor_name}</p>
            <p>{detail.requested_tests}</p>
            <p>Status: {sampleStageLabels[detail.stage]}</p>
            {detail.specimens.length > 0 && (
              <p>
                Uzorci:{" "}
                {detail.specimens
                  .map((s) => s.code + " · " + s.name)
                  .join(", ")}
              </p>
            )}
            <h3>Povijest uzorkovanja i obrade</h3>
            {detail.history.length ? (
              <ol className="lab-sample-history">
                {detail.history.map((event) => (
                  <li key={event.id}>
                    <strong>{sampleStageLabels[event.status]}</strong>
                    <p>
                      {dateLabel(event.created_at)} u{" "}
                      {zagrebTime(event.created_at)} ·{" "}
                      {event.actor ?? "Laboratorij"}
                    </p>
                    {event.reason && <p>{event.reason}</p>}
                  </li>
                ))}
              </ol>
            ) : (
              <p>Još nema evidentiranih promjena uzorka.</p>
            )}
          </div>
        </Modal>
      )}
      {result &&
        (result.edit ? (
          <LabResultEditor
            order={result.order}
            onClose={() => setResult(null)}
            onSaved={() => {
              setResult(null);
              setSuccess("Nalaz je objavljen i dostupan pacijentu.");
              resource.refresh();
            }}
          />
        ) : (
          <Modal
            title={result.order.number}
            wide
            onClose={() => setResult(null)}
          >
            <div className="modal-content">
              {result.order.results.map((r) => (
                <LabResultView key={r.id} result={r} mode="LAB" />
              ))}
            </div>
          </Modal>
        ))}
    </>
  );
}
