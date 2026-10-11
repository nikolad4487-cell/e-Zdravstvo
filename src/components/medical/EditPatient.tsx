import { useState } from "react";
import type { Patient } from "../../types/clinical";
import { updatePatientDetails } from "../../services/clinical";
import { readableError, today } from "../../utils/format";
import { Modal } from "../ui/Modal";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";

export function PatientDetailsFields({ patient }: { patient?: Patient }) {
  return (
    <>
      <Field
        label="Ime"
        name="first_name"
        required
        maxLength={100}
        defaultValue={patient?.first_name}
      />
      <Field
        label="Prezime"
        name="last_name"
        required
        maxLength={100}
        defaultValue={patient?.last_name}
      />
      <Field
        label="Datum rođenja"
        name="birth_date"
        type="date"
        required
        min="1900-01-01"
        max={today()}
        defaultValue={patient?.birth_date}
      />
      <Field
        label="Spol"
        name="sex"
        required
        defaultValue={patient?.sex ?? "UNKNOWN"}
      >
        <option value="UNKNOWN">Nije naveden</option>
        <option value="F">Ženski</option>
        <option value="M">Muški</option>
        <option value="OTHER">Drugo</option>
      </Field>
      <Field
        label="Adresa"
        name="address"
        maxLength={300}
        defaultValue={patient?.address ?? ""}
      />
      <Field
        label="Grad"
        name="city"
        maxLength={150}
        defaultValue={patient?.city ?? ""}
      />
      <Field
        label="Poštanski broj"
        name="postal_code"
        maxLength={20}
        defaultValue={patient?.postal_code ?? ""}
      />
      <Field
        label="Telefon"
        name="phone"
        maxLength={50}
        defaultValue={patient?.phone ?? ""}
      />
      <Field
        label="E-mail"
        name="email"
        type="email"
        maxLength={254}
        defaultValue={patient?.email ?? ""}
      />
      <Field
        label="Zdravstveno osiguranje"
        name="insurance"
        maxLength={300}
        defaultValue={patient?.insurance ?? ""}
      />
      <Field
        label="Kontakt za hitne slučajeve"
        name="emergency_contact"
        maxLength={500}
        defaultValue={patient?.emergency_contact ?? ""}
      />
    </>
  );
}
export function EditPatient({
  patient,
  onClose,
  onSaved,
}: {
  patient: Patient;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = values(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await updatePatientDetails(patient, data);
      onSaved();
    } catch (error) {
      setError(readableError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Uredi pacijenta" onClose={onClose} busy={busy} wide>
      <form onSubmit={save}>
        <p className="form-intro">
          Uredite osobne i kontaktne podatke pacijenta. Kontaktni e-mail ne
          mijenja adresu za prijavu ili dostavu potvrda.
        </p>
        <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <div className="form-grid">
            <PatientDetailsFields patient={patient} />
          </div>
        </fieldset>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="modal-actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={busy}
          >
            Odustani
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Spremanje…" : "Spremi promjene"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
