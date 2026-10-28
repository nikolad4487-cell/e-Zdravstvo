import { useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  carePathways,
  reviewCareResult,
  createCareFollowup,
  resolveCareFollowup,
  careStageLabels,
  type CareItem,
} from "../../services/carePathways";
import {
  downloadLabResult,
  downloadMedicalReport,
} from "../../services/reports";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel, readableError } from "../../utils/format";
import { zagrebDate, shiftDate } from "../../utils/calendar";
export function CarePathways({ patientId }: { patientId?: string }) {
  const [search, setSearch] = useState(""),
    [draft, setDraft] = useState(""),
    [stage, setStage] = useState(""),
    [closed, setClosed] = useState(false),
    [page, setPage] = useState(0),
    [action, setAction] = useState<{
      kind: "REVIEW" | "FOLLOWUP" | "RESOLVE";
      item: CareItem;
      request: string;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const resource = useResource(
    () => carePathways(patientId, search, stage, closed, page),
    JSON.stringify([patientId, search, stage, closed, page]),
  );
  useScheduleRefresh(resource.refresh);
  function open(kind: "REVIEW" | "FOLLOWUP" | "RESOLVE", item: CareItem) {
    setError("");
    setAction({ kind, item, request: crypto.randomUUID() });
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!action) return;
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (action.kind === "REVIEW") await reviewCareResult(action.item);
      else if (action.kind === "FOLLOWUP")
        await createCareFollowup(
          action.item.patient_id,
          data.due_on,
          data.title,
          action.request,
          action.item,
        );
      else await resolveCareFollowup(action.item, data.status, data.resolution);
      setAction(null);
      setSuccess("Zapis je spremljen.");
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function download(row: CareItem) {
    if (!row.result_id) return;
    setBusy(true);
    setError("");
    try {
      if (row.result_kind === "LAB_RESULT")
        await downloadLabResult(row.result_id);
      else await downloadMedicalReport(row.result_id);
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
          <h2>Tijek skrbi i obveze</h2>
          <p>Uputnice, termini, nalazi i kontrolne obveze na jednom mjestu.</p>
        </div>
        <button
          type="button"
          className="secondary"
          disabled={busy || resource.loading}
          onClick={resource.refresh}
        >
          Osvježi tijek
        </button>
      </div>
      <form
        className="card spaced"
        aria-label="Pretraga tijeka skrbi"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(draft.trim());
          setPage(0);
        }}
      >
        <div className="form-grid">
          <Field
            name="care_search"
            label="Pretraži tijek skrbi"
            value={draft}
            maxLength={200}
            onChange={(e) => setDraft(e.target.value)}
          />
          <Field
            name="care_stage"
            label="Stanje obveze"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value);
              setPage(0);
            }}
          >
            <option value="">Sva stanja</option>
            {Object.entries(careStageLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Field>
        </div>
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
            Prikaži i pregledane / zaključene stavke
          </label>
        </div>
      </form>
      {success && (
        <p role="status" className="feedback success">
          {success}
        </p>
      )}
      {(resource.error || (!action && error)) && (
        <ErrorMessage>{resource.error || error}</ErrorMessage>
      )}
      <p className="note-text">
        Kontrolna obveza je liječnički podsjetnik; termin pregleda naručuje se
        zasebno.
      </p>
      {resource.loading ? (
        <p role="status">Učitavanje tijeka skrbi…</p>
      ) : resource.data?.items.length ? (
        <div className="section-stack">
          {resource.data.items.map((row) => (
            <section className="card" key={row.source_kind + row.source_id}>
              <div className="section-heading">
                <h3>{row.title}</h3>
                <span className="sample-stage">
                  {careStageLabels[row.stage]}
                </span>
              </div>
              <p>
                <strong>{row.patient_name}</strong> · {row.patient_number}
              </p>
              <p>{row.detail}</p>
              {row.critical && !row.acknowledged && (
                <p className="medical-alert">
                  Kritičan nalaz čeka potvrdu preuzimanja.{" "}
                  <Link
                    to={`/ordinacija/pacijenti/${row.patient_id}?tab=LABORATORIJ`}
                  >
                    Otvori laboratorijske rezultate
                  </Link>
                </p>
              )}
              <p className="note-text">
                {dateLabel(zagrebDate(new Date(row.event_at)))}
                {row.due_on ? ` · Rok: ${dateLabel(row.due_on)}` : ""}
              </p>
              {row.origin && (
                <p className="note-text">
                  Kontrolna obveza povezana je s izvornim zapisom.
                </p>
              )}
              {row.referral_id && (
                <p className="note-text">Termin je povezan s uputnicom.</p>
              )}
              <div className="document-actions">
                <Link
                  className="secondary"
                  to={`/ordinacija/pacijenti/${row.patient_id}?tab=${row.source_kind === "REFERRAL" ? "UPUTNICE" : row.result_kind === "LAB_RESULT" || row.source_kind === "LAB_ORDER" ? "LABORATORIJ" : row.source_kind === "BOOKING" ? "NARUDŽBE" : "NALAZI"}`}
                >
                  Otvori u kartonu
                </Link>
                {row.result_id && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => download(row)}
                  >
                    Preuzmi nalaz
                  </button>
                )}
                {row.stage === "NEEDS_REVIEW" && (
                  <button
                    className="primary"
                    type="button"
                    disabled={busy || (row.critical && !row.acknowledged)}
                    onClick={() => open("REVIEW", row)}
                  >
                    Potvrdi pregled nalaza
                  </button>
                )}
                {row.source_kind !== "FOLLOWUP" && (
                  <button
                    className="secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => open("FOLLOWUP", row)}
                  >
                    Dodaj kontrolnu obvezu
                  </button>
                )}
                {row.source_kind === "FOLLOWUP" && row.stage !== "CLOSED" && (
                  <button
                    className="primary"
                    type="button"
                    disabled={busy}
                    onClick={() => open("RESOLVE", row)}
                  >
                    Zaključi obvezu
                  </button>
                )}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="card empty-state">
          Nema stavki za odabrane filtre.
        </section>
      )}
      <div className="document-actions spaced">
        <button
          className="secondary"
          disabled={page === 0 || resource.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodna stranica
        </button>
        <span>
          {resource.data?.total ?? 0} stavki · stranica {page + 1}
        </span>
        <button
          className="secondary"
          disabled={
            (page + 1) * 50 >= (resource.data?.total ?? 0) || resource.loading
          }
          onClick={() => setPage(page + 1)}
        >
          Sljedeća stranica
        </button>
      </div>
      {action && (
        <Modal
          title={
            action.kind === "REVIEW"
              ? "Pregled nalaza"
              : action.kind === "FOLLOWUP"
                ? "Nova kontrolna obveza"
                : "Zaključivanje obveze"
          }
          busy={busy}
          onClose={() => {
            setAction(null);
            setError("");
          }}
        >
          <form onSubmit={submit}>
            <p>
              <strong>{action.item.patient_name}</strong> · {action.item.title}
            </p>
            {action.kind === "REVIEW" ? (
              <label>
                <input type="checkbox" required /> Potvrđujem da sam
                pregledao/la ovaj nalaz.
              </label>
            ) : action.kind === "FOLLOWUP" ? (
              <>
                <Field
                  name="title"
                  label="Opis kontrolne obveze"
                  required
                  minLength={3}
                  maxLength={300}
                />
                <Field
                  name="due_on"
                  label="Rok kontrole"
                  type="date"
                  required
                  min={zagrebDate()}
                  max={shiftDate(zagrebDate(), 730)}
                />
              </>
            ) : (
              <>
                <Field name="status" label="Ishod" defaultValue="DONE">
                  <option value="DONE">Obveza izvršena</option>
                  <option value="CANCELLED">Obveza otkazana</option>
                </Field>
                <Field
                  name="resolution"
                  label="Obrazloženje"
                  type="textarea"
                  required
                  minLength={5}
                  maxLength={1000}
                />
              </>
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                {busy ? "Spremanje…" : "Spremi"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
