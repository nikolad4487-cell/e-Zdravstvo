import { useEffect, useState } from "react";
import { useResource } from "../../hooks/useResource";
import { useScheduleRefresh } from "../../hooks/useScheduleRefresh";
import {
  myMedications,
  pharmacyLookup,
  pharmacyInstitutions,
  type PharmacyPrescription,
} from "../../services/pharmacy";
import { Field, values } from "../ui/Fields";
import { Modal } from "../ui/Modal";
import { ErrorMessage } from "../ui/Feedback";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { documentStatusLabels } from "../../types/documents";
import { dateLabel, readableError } from "../../utils/format";
function PrescriptionDetails({ p }: { p: PharmacyPrescription }) {
  return (
    <>
      <h3>
        {p.number} · {documentStatusLabels[p.status] ?? p.status}
      </h3>
      <p>
        {p.patient_name} · {p.patient_number}
      </p>
      <p>
        Propisao: {p.doctor_name} · {dateLabel(p.issued_at)} · Vrijedi do{" "}
        {dateLabel(p.expires_on)}
      </p>
      {p.items.map((m, i) => (
        <div className="clinical-note" key={i}>
          <strong>
            {m.name} · {m.strength}
          </strong>
          <p>
            {m.dosage} · Propisano: {m.quantity} · Izdano: {m.dispensed} ·
            Preostalo: {m.remaining}
          </p>
          <p>
            {m.route} · {m.duration}
          </p>
          {m.notes && <p>{m.notes}</p>}
        </div>
      ))}
      {p.dispensing_events.map((e) => (
        <div className="clinical-note" key={e.id}>
          <strong>Preuzimanje · {dateLabel(e.created_at)}</strong>
          <p>
            {e.institution_name} · {e.pharmacist_name}
          </p>
          {e.items.map((i) => (
            <p key={i.index}>
              {p.items[i.index]?.name} · Količina: {i.quantity}
            </p>
          ))}
        </div>
      ))}
      {p.dispensation && (
        <div className="confirm-box">
          <strong>Preuzeto u ljekarni</strong>
          <p>
            {p.dispensation.institution_name} · {p.dispensation.pharmacist_name}
          </p>
          <p>
            {new Date(p.dispensation.created_at).toLocaleString("hr-HR", {
              timeZone: "Europe/Zagreb",
            })}
          </p>
        </div>
      )}
    </>
  );
}
export function PatientMedications() {
  const [active, setActive] = useState(false),
    [page, setPage] = useState(0),
    [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const resource = useResource(
    () => myMedications(active, page, term),
    String(active) + page + term,
  );
  useScheduleRefresh(resource.refresh);
  const rows = resource.data ?? [];
  return (
    <>
      <h2>Lijekovi</h2>
      <p>Propisani lijekovi i evidentirana preuzimanja u ljekarnama sustava.</p>
      <div className="form-grid">
        <label className="field">
          <span>Pretraži sve propisane lijekove</span>
          <input
            maxLength={100}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => {
              setActive(e.target.checked);
              setPage(0);
            }}
          />{" "}
          Samo važeći nerealizirani recepti
        </label>
      </div>
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading ? (
        <p role="status">Učitavanje lijekova…</p>
      ) : rows.length ? (
        rows.map((p) => (
          <section className="card spaced" key={p.id}>
            <PrescriptionDetails p={p} />
          </section>
        ))
      ) : (
        <section className="card empty-state">
          Nema lijekova za odabrani prikaz.
        </section>
      )}
      <div className="document-actions">
        <button
          className="secondary"
          disabled={!page}
          onClick={() => setPage(page - 1)}
        >
          Prethodna
        </button>
        <span>Stranica {page + 1}</span>
        <button
          className="secondary"
          disabled={resource.data?.length !== 50}
          onClick={() => setPage(page + 1)}
        >
          Sljedeća
        </button>
      </div>
    </>
  );
}
export function PharmacyPanel() {
  const institutions = useResource(pharmacyInstitutions, "pharmacy"),
    [prescription, setPrescription] = useState<PharmacyPrescription | null>(
      null,
    ),
    [searched, setSearched] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [success, setSuccess] = useState(""),
    [requestId, setRequestId] = useState(crypto.randomUUID());
  async function lookup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = values(e.currentTarget);
    setBusy(true);
    setError("");
    setPrescription(null);
    setSuccess("");
    try {
      setPrescription(await pharmacyLookup(data.number, data.patient));
      setSearched(true);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function dispense(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!prescription) return;
    setBusy(true);
    setError("");
    try {
      const data = values(e.currentTarget);
      const items = prescription.items
        .map((_, index) => ({
          index,
          quantity: Number(data["quantity_" + index] ?? 0),
        }))
        .filter((i) => i.quantity > 0);
      unwrap(
        await db().rpc("dispense_prescription_items", {
          document_id: prescription.id,
          patient_number: prescription.patient_number,
          institution_id: data.institution,
          items,
          request_id: requestId,
        }),
      );
      setConfirm(false);
      setPrescription(
        await pharmacyLookup(prescription.number, prescription.patient_number),
      );
      setSuccess("Realizacija je evidentirana i vidljiva pacijentu.");
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
          <div className="eyebrow">e-ZDRAVSTVO LJEKARNA</div>
          <h1>Realizacija recepta</h1>
          <p>
            Unesite broj recepta i interni broj pacijenta za pristup
            pojedinačnom receptu.
          </p>
        </div>
      </div>
      <section className="card">
        <form onSubmit={lookup}>
          <div className="form-grid">
            <Field
              name="number"
              label="Broj recepta"
              required
              maxLength={50}
              placeholder="EZ-REC-2026-00000001"
            />
            <Field
              name="patient"
              label="Interni broj pacijenta"
              required
              maxLength={40}
              placeholder="EZ-PAC-00000001"
            />
          </div>
          <button className="primary spaced" disabled={busy}>
            Pronađi recept
          </button>
        </form>
      </section>
      {(error || institutions.error) && (
        <ErrorMessage>{error || institutions.error}</ErrorMessage>
      )}
      {success && (
        <p className="success-toast" role="status">
          {success}
        </p>
      )}
      {prescription ? (
        <section className="card spaced">
          <PrescriptionDetails p={prescription} />
          {prescription.status === "ISSUED" && (
            <button
              className="primary"
              onClick={() => {
                setRequestId(crypto.randomUUID());
                setConfirm(true);
              }}
            >
              Evidentiraj preuzimanje
            </button>
          )}
        </section>
      ) : (
        searched &&
        !busy && <p className="empty-state">Nema recepta za unesene podatke.</p>
      )}
      {confirm && prescription && (
        <Modal
          title="Potvrda realizacije"
          busy={busy}
          onClose={() => setConfirm(false)}
        >
          <form onSubmit={dispense}>
            <p className="confirm-box">
              Unesite stvarno izdane količine. Recept se zatvara nakon izdavanja
              svih stavki; preostale količine mogu se preuzeti kasnije unutar
              roka valjanosti.
            </p>
            {prescription.items.map((m, index) => (
              <Field
                key={index}
                name={"quantity_" + index}
                label={`${m.name} · Preostalo: ${m.remaining}`}
                type="number"
                min={0}
                max={m.remaining}
                step="1"
                defaultValue={String(m.remaining)}
                required
              />
            ))}
            <Field name="institution" label="Ljekarna / ustanova" required>
              <option value="">Odaberite ustanovu</option>
              {institutions.data?.map((i) => (
                <option value={i.id} key={i.id}>
                  {i.name}
                </option>
              ))}
            </Field>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                Potvrdi realizaciju
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
