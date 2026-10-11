import { useState } from "react";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { chartSchema } from "../../types/clinical";
import { readableError } from "../../utils/format";
import { ErrorMessage } from "../ui/Feedback";
export function FhirExport({ patientId }: { patientId: string }) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function download() {
    setBusy(true);
    setError("");
    try {
      const chart = chartSchema.parse(
        unwrap(
          await db().rpc("export_patient_record", { patient_id: patientId }),
        ),
      );
      const { chartToFhir } = await import("../../utils/fhir");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(chartToFhir(chart), null, 2)], {
          type: "application/fhir+json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${chart.patient.patient_number.replace(/[^a-zA-Z0-9-]/g, "")}-fhir.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="spaced">
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={() => void download()}
      >
        {busy ? "Priprema izvoza…" : "Preuzmi karton kao FHIR JSON"}
      </button>
      <p className="muted">
        Izvoz prikazanog kartona: identitet, pregledi, vitalni parametri,
        dijagnoze, alergije i terapija. Laboratorijski nalazi, izdani dokumenti
        i privitci nisu uključeni. Datoteka se preuzima na vaš uređaj.
      </p>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}
