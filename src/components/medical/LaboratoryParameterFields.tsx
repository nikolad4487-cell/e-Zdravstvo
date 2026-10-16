import { useState } from "react";
import type { z } from "zod";
import type { labParameterSchema } from "../../types/laboratory";
import { MedicalCodePicker } from "./MedicalCodePicker";
import { Field } from "../ui/Fields";
export function LaboratoryParameterFields({
  index,
  previous,
}: {
  index: number;
  previous?: z.infer<typeof labParameterSchema>;
}) {
  const [source, setSource] = useState(
    previous && !previous.catalog_list ? "LOCAL" : "CEZIH",
  );
  const [kind, setKind] = useState(previous?.text_value ? "TEXT" : "NUMERIC");
  const [official, setOfficial] = useState({
    name: previous?.name ?? "",
    unit: previous?.unit ?? "",
  });
  return (
    <div className="form-grid">
      <Field
        name={"parameter_source_" + index}
        label="Izvor šifre parametra"
        value={source}
        onChange={(e) => setSource(e.target.value)}
      >
        <option value="CEZIH">CEZIH – rezultati pretraga (2.2.31)</option>
        <option value="LOCAL">Lokalni parametar / drugi šifrarnik</option>
      </Field>
      <input
        type="hidden"
        name={"catalog_list_" + index}
        value={source === "CEZIH" ? "2.2.31" : ""}
      />
      {source === "CEZIH" ? (
        <>
          <MedicalCodePicker
            list="2.2.31"
            name={"code_" + index}
            label="Parametar iz CEZIH šifrarnika"
            required
            initial={
              previous?.catalog_list === "2.2.31"
                ? [
                    {
                      list_id: "2.2.31",
                      code: previous.code,
                      name: previous.name,
                      description: previous.name,
                    },
                  ]
                : []
            }
            onSelected={(items) =>
              setOfficial({
                name: items[0]?.name ?? "",
                unit: items[0]?.description.split(" | ")[2] ?? "",
              })
            }
          />
          <input type="hidden" name={"name_" + index} value={official.name} />
          <input type="hidden" name={"unit_" + index} value={official.unit} />
          <p className="field-full">
            Jedinica prema šifrarniku: {official.unit || "nije navedena"}
          </p>
        </>
      ) : (
        <>
          <Field
            name={"code_" + index}
            label="Šifra parametra"
            required
            maxLength={40}
            defaultValue={previous?.code}
          />
          <Field
            name={"name_" + index}
            label="Naziv parametra"
            required
            maxLength={150}
            defaultValue={previous?.name}
          />
          <Field
            name={"unit_" + index}
            label="Jedinica"
            maxLength={50}
            defaultValue={previous?.unit}
          />
        </>
      )}
      <Field
        name={"value_kind_" + index}
        label="Vrsta vrijednosti"
        value={kind}
        onChange={(e) => setKind(e.target.value)}
      >
        <option value="NUMERIC">Brojčana vrijednost</option>
        <option value="TEXT">Tekstualni / kvalitativni rezultat</option>
      </Field>
      {kind === "TEXT" ? (
        <Field
          name={"text_value_" + index}
          label="Tekst rezultata"
          type="textarea"
          required
          maxLength={2000}
          defaultValue={previous?.text_value ?? ""}
        />
      ) : (
        <>
          <Field
            name={"value_" + index}
            label="Izmjerena vrijednost"
            type="number"
            step="any"
            required
            min={-1e12}
            max={1e12}
            defaultValue={previous?.value ?? undefined}
          />
          <Field
            name={"low_" + index}
            label="Referentna donja granica"
            type="number"
            step="any"
            defaultValue={previous?.reference_low ?? undefined}
          />
          <Field
            name={"high_" + index}
            label="Referentna gornja granica"
            type="number"
            step="any"
            defaultValue={previous?.reference_high ?? undefined}
          />
        </>
      )}
      <label>
        <input
          type="checkbox"
          name={"critical_" + index}
          value="true"
          defaultChecked={previous?.flag === "CRITICAL"}
        />{" "}
        Označi kao kritičan rezultat
      </label>
    </div>
  );
}
