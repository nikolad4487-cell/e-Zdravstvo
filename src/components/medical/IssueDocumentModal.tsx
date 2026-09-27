import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { useResource } from "../../hooks/useResource";
import { getContext } from "../../services/clinical";
import { issueDocument } from "../../services/documents";
import { Field, values } from "../ui/Fields";
import { Modal } from "../ui/Modal";
import { ErrorMessage } from "../ui/Feedback";
import type { PatientChart } from "../../types/clinical";
import type { DocumentKind } from "../../types/documents";
import type { Json } from "../../lib/database.types";
import { kindLabels } from "../../types/documents";
import { dateLabel, readableError, today } from "../../utils/format";
export const referralTypes: Record<string, string> = {
  SPECIALIST: "Specijalistički pregled",
  LABORATORY: "Laboratorij",
  DIAGNOSTICS: "Dijagnostika",
  HOSPITAL: "Bolničko liječenje",
  FOLLOW_UP: "Kontrolni pregled",
  PHYSICAL_THERAPY: "Fizikalna terapija",
  OTHER: "Ostalo",
};
export function IssueDocumentModal({
  kind,
  chart,
  onClose,
  onSaved,
}: {
  kind: DocumentKind;
  chart: PatientChart;
  onClose: () => void;
  onSaved: () => void;
}) {
  const context = useResource(getContext, "issue-context");
  const [items, setItems] = useState([0]),
    [next, setNext] = useState(1),
    [draft, setDraft] = useState<{ data: Json; summary: string[] } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  const expiry = new Date(
    Date.now() +
      (kind === "PRESCRIPTION" ? 30 : kind === "REFERRAL" ? 90 : 365) *
        86400000,
  )
    .toISOString()
    .slice(0, 10);
  function review(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    const data = values(e.currentTarget);
    const summary = [
      `${chart.patient.first_name} ${chart.patient.last_name}`,
      `Vrijedi do: ${dateLabel(data.expires_on)}`,
    ];
    if (kind === "PRESCRIPTION") {
      const lines = items.map((i) => ({
        medication_id: data["medication_" + i],
        dosage: data["dosage_" + i],
        quantity: Number(data["quantity_" + i]),
        route: data["route_" + i],
        duration: data["duration_" + i],
        notes: data["notes_" + i],
      }));
      summary.push(
        ...lines.map(
          (l) =>
            `${context.data?.medications.find((m) => m.id === l.medication_id)?.name}: ${l.dosage}; količina ${l.quantity}; ${l.route}; ${l.duration}`,
        ),
      );
      setDraft({
        data: {
          expires_on: data.expires_on,
          encounter_id: data.encounter_id,
          items: lines,
        },
        summary,
      });
    } else {
      if (kind === "SCHOOL_EXCUSE") {
        if (data.date_to < data.date_from) {
          setError("Datum završetka mora biti nakon datuma početka.");
          return;
        }
        summary.push(
          `Izostanak: ${dateLabel(data.date_from)} – ${dateLabel(data.date_to)}`,
          `Kategorija: ${data.category}`,
          `Škola: ${data.school || "Nije navedena"}`,
          data.notes,
        );
      } else
        summary.push(
          referralTypes[data.referral_type],
          data.specialty,
          data.reason,
          data.priority === "URGENT"
            ? "Prioritet: hitno"
            : "Prioritet: redovno",
          data.notes,
        );
      setDraft({ data, summary });
    }
  }
  async function confirm() {
    if (!draft) return;
    setBusy(true);
    setError("");
    try {
      await issueDocument(chart.patient.id, kind, draft.data, requestId);
      onSaved();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={kindLabels[kind] + " · izdavanje"}
      onClose={onClose}
      busy={busy}
      wide
    >
      <form onSubmit={review} hidden={!!draft}>
        <p className="form-intro">
          {chart.patient.first_name} {chart.patient.last_name} ·{" "}
          {chart.patient.patient_number}
        </p>
        <div className="form-grid">
          <Field
            name="expires_on"
            label="Vrijedi do"
            type="date"
            min={today()}
            defaultValue={expiry}
            required
          />
          <Field name="encounter_id" label="Povezani pregled">
            <option value="">Bez povezivanja</option>
            {chart.encounters
              .filter((e) => !e.superseded_by)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {dateLabel(e.encountered_at)} · {e.kind}
                </option>
              ))}
          </Field>
        </div>
        {kind === "PRESCRIPTION" && (
          <>
            <p className="form-intro">
              Razvojni šifrarnik sadrži testne pripravke, a ne stvarne lijekove.
            </p>
            {items.map((i, index) => (
              <section className="prescription-line" key={i}>
                <div className="section-heading">
                  <h3>Stavka {index + 1}</h3>
                  {items.length > 1 && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={"Ukloni stavku " + (index + 1)}
                      onClick={() => setItems(items.filter((x) => x !== i))}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
                <div className="form-grid">
                  <Field name={"medication_" + i} label="Lijek" required>
                    <option value="">Odaberite lijek</option>
                    {context.data?.medications.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} · {m.strength} · {m.form}
                      </option>
                    ))}
                  </Field>
                  <Field
                    name={"dosage_" + i}
                    label="Doziranje"
                    required
                    maxLength={500}
                  />
                  <Field
                    name={"quantity_" + i}
                    label="Količina pakiranja"
                    type="number"
                    min={1}
                    max={999}
                    defaultValue={1}
                    required
                  />
                  <Field
                    name={"route_" + i}
                    label="Način primjene"
                    required
                    maxLength={200}
                  />
                  <Field
                    name={"duration_" + i}
                    label="Trajanje terapije"
                    required
                    maxLength={300}
                  />
                  <Field
                    name={"notes_" + i}
                    label="Napomena"
                    type="textarea"
                    maxLength={2000}
                  />
                </div>
              </section>
            ))}
            <button
              type="button"
              className="secondary"
              disabled={items.length >= 20}
              onClick={() => {
                setItems([...items, next]);
                setNext(next + 1);
              }}
            >
              <Plus size={14} />
              Dodaj lijek
            </button>
          </>
        )}
        {kind === "REFERRAL" && (
          <div className="form-grid spaced">
            <Field name="referral_type" label="Vrsta uputnice" required>
              {Object.entries(referralTypes).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Field>
            <Field
              name="specialty"
              label="Specijalnost / odredište"
              required
              maxLength={200}
            />
            <Field name="diagnosis_id" label="Dijagnoza">
              <option value="">Nije navedena</option>
              {context.data?.diagnoses.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </Field>
            <Field name="priority" label="Prioritet">
              <option value="REGULAR">Redovno</option>
              <option value="URGENT">Hitno</option>
            </Field>
            <div className="field-full">
              <Field
                name="reason"
                label="Razlog upućivanja"
                type="textarea"
                required
                maxLength={4000}
              />
            </div>
            <div className="field-full">
              <Field
                name="notes"
                label="Napomena"
                type="textarea"
                maxLength={4000}
              />
            </div>
          </div>
        )}
        {kind === "SCHOOL_EXCUSE" && (
          <div className="form-grid spaced">
            <Field
              name="date_from"
              label="Opravdani izostanak od"
              type="date"
              defaultValue={today()}
              min={chart.patient.birth_date}
              required
            />
            <Field
              name="date_to"
              label="Opravdani izostanak do"
              type="date"
              defaultValue={today()}
              required
            />
            <Field
              name="category"
              label="Razlog / kategorija"
              required
              maxLength={200}
            />
            <Field name="school" label="Škola (opcionalno)" maxLength={300} />
            <div className="field-full">
              <Field
                name="notes"
                label="Napomena"
                type="textarea"
                maxLength={4000}
              />
            </div>
          </div>
        )}
        {(error || context.error) && (
          <ErrorMessage>{error || context.error}</ErrorMessage>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Odustani
          </button>
          <button
            className="primary"
            disabled={context.loading || !!context.error}
          >
            Pregledaj prije izdavanja
          </button>
        </div>
      </form>
      {draft && (
        <div className="modal-content">
          <div className="confirm-box">
            <h3>Potvrda izdavanja</h3>
            {draft.summary.filter(Boolean).map((s, i) => (
              <p key={i}>{s}</p>
            ))}
          </div>
          <p className="form-intro spaced">
            Jeste li sigurni da želite izdati ovaj dokument? Nakon izdavanja bit
            će vidljiv pacijentu. Sadržaj se ne može prepisati; dokument se može
            opozvati i izdati novi.
          </p>
          <p className="signature-note">
            Razvojni digitalni potpis – nije kvalificirani elektronički potpis.
          </p>
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
              onClick={() => void confirm()}
            >
              {busy ? "Izdavanje…" : "Potvrdi izdavanje"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
