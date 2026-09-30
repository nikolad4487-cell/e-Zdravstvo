import { useState } from "react";
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
            {m.dosage} · Količina: {m.quantity}
          </p>
          <p>
            {m.route} · {m.duration}
          </p>
          {m.notes && <p>{m.notes}</p>}
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
  const resource = useResource(
    () => myMedications(active, page),
    String(active) + page,
  );
  useScheduleRefresh(resource.refresh);
  const rows =
    resource.data?.filter((p) =>
      p.items.some((i) =>
        i.name.toLocaleLowerCase("hr").includes(search.toLocaleLowerCase("hr")),
      ),
    ) ?? [];
  return (
    <>
      <h2>Lijekovi</h2>
      <p>Propisani lijekovi i evidentirana preuzimanja u ljekarnama sustava.</p>
      <div className="form-grid">
        <label className="field">
          <span>Pretraži lijekove na stranici</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} />
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
    [success, setSuccess] = useState("");
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
      unwrap(
        await db().rpc("dispense_prescription", {
          document_id: prescription.id,
          patient_number: prescription.patient_number,
          institution_id: values(e.currentTarget).institution,
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
            <button className="primary" onClick={() => setConfirm(true)}>
              Realiziraj recept
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
              Potvrđujete izdavanje svih propisanih stavki u cijelosti. Recept
              će biti označen realiziranim i neće ga biti moguće ponovno
              realizirati.
            </p>
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
