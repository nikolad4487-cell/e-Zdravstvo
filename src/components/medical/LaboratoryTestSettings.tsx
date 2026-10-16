import { useState } from "react";
import type { z } from "zod";
import type { laboratoryStepSchema } from "../../types/hospital";
import type { PriorityService } from "../../services/priorityHospital";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { Field, values } from "../ui/Fields";
import { ErrorMessage } from "../ui/Feedback";
import { readableError } from "../../utils/format";
type Step = z.infer<typeof laboratoryStepSchema>;
export function LaboratoryTestSettings({
  service,
  onSaved,
}: {
  service: PriorityService;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const test = service.laboratory_tests.find((t) => t.id === selected);
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = values(e.currentTarget);
      unwrap(
        await db().rpc("save_hospital_laboratory_test", {
          service_id: service.id,
          test_id: selected || null,
          data: { ...data, active: data.active !== "false", steps },
        }),
      );
      setSelected("");
      setSteps([]);
      onSaved();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card spaced">
      <h3>Pretrage i protokoli laboratorija</h3>
      <p>
        Šifra postupka: <strong>{service.procedure_code}</strong>. Pretrage,
        obvezno vrijeme uzorkovanja i pisane upute održava odgovorno osoblje
        laboratorija. Šifra pretrage može biti interna; ne predstavlja
        automatski službenu šifru HZZO-a.
      </p>
      <Field
        name="laboratory_test_selection"
        label="Pretraga za uređivanje"
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          setSteps(
            service.laboratory_tests.find((t) => t.id === e.target.value)
              ?.steps ?? [],
          );
          setError("");
        }}
      >
        <option value="">Nova pretraga</option>
        {service.laboratory_tests.map((t) => (
          <option key={t.id} value={t.id}>
            {t.code} · {t.name}
            {t.active === false ? " · neaktivna" : ""}
          </option>
        ))}
      </Field>
      <form
        key={selected + JSON.stringify(test)}
        onSubmit={save}
        className="spaced"
      >
        <div className="form-grid">
          <Field
            name="code"
            label="Šifra pretrage"
            required
            maxLength={40}
            defaultValue={test?.code}
          />
          <Field
            name="name"
            label="Naziv pretrage / protokola"
            required
            minLength={2}
            maxLength={200}
            defaultValue={test?.name}
          />
          <Field
            name="required_time"
            label="Obvezno vrijeme uzorkovanja (ako je određeno)"
            type="time"
            defaultValue={test?.required_time?.slice(0, 5) ?? ""}
          />
          <Field
            name="active"
            label="Dostupnost pretrage"
            defaultValue={String(test?.active ?? true)}
          >
            <option value="true">Aktivna</option>
            <option value="false">Pauzirana</option>
          </Field>
          <div className="field-full">
            <Field
              name="instructions"
              label="Upute za pripremu i dolazak"
              type="textarea"
              maxLength={4000}
              defaultValue={test?.instructions}
            />
          </div>
        </div>
        <p className="note-text">
          Bez obveznog sata nude se termini prema smjeni. Za bazalni kortizol u
          08:00 unesite 08:00 i postavite jutarnju smjenu. Pretrage s različitim
          obveznim satima naručuju se odvojeno.
        </p>
        <h4>Povezani koraci i priprema</h4>
        <p className="note-text">
          Koraci su pisani plan uz glavnu narudžbu; dodatna uzorkovanja koja
          trebaju zaseban rezerviran termin naručite odvojeno. Unosite samo
          protokol koji je odobrio odgovorni liječnik/laboratorij.
        </p>
        {steps.map((step, index) => (
          <div className="card spaced" key={index}>
            <div className="form-grid">
              <Field
                name={"step_label_" + index}
                label="Naziv koraka"
                required
                minLength={2}
                maxLength={200}
                value={step.label}
                onChange={(e) =>
                  setSteps(
                    steps.map((s, i) =>
                      i === index ? { ...s, label: e.target.value } : s,
                    ),
                  )
                }
              />
              <Field
                name={"step_day_" + index}
                label="Dan u odnosu na termin (−1 prethodni, 0 isti dan)"
                type="number"
                min={-7}
                max={7}
                required
                value={String(step.day_offset)}
                onChange={(e) =>
                  setSteps(
                    steps.map((s, i) =>
                      i === index
                        ? { ...s, day_offset: Number(e.target.value) }
                        : s,
                    ),
                  )
                }
              />
              <Field
                name={"step_time_" + index}
                label="Vrijeme koraka"
                type="time"
                required
                value={step.time}
                onChange={(e) =>
                  setSteps(
                    steps.map((s, i) =>
                      i === index ? { ...s, time: e.target.value } : s,
                    ),
                  )
                }
              />
              <Field
                name={"step_instruction_" + index}
                label="Uputa za korak"
                type="textarea"
                maxLength={2000}
                value={step.instructions ?? ""}
                onChange={(e) =>
                  setSteps(
                    steps.map((s, i) =>
                      i === index ? { ...s, instructions: e.target.value } : s,
                    ),
                  )
                }
              />
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => setSteps(steps.filter((_, i) => i !== index))}
            >
              Ukloni korak {index + 1}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary spaced"
          disabled={steps.length >= 10 || busy}
          onClick={() =>
            setSteps([
              ...steps,
              { day_offset: 0, time: "08:00", label: "", instructions: "" },
            ])
          }
        >
          Dodaj povezani korak
        </button>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="modal-actions">
          <button className="primary" disabled={busy}>
            {busy ? "Spremanje…" : "Spremi pretragu"}
          </button>
        </div>
      </form>
    </section>
  );
}
