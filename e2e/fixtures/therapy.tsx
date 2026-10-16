import { createRoot } from "react-dom/client";
import { ClinicalModal } from "../../src/components/medical/ClinicalModal";
import type { PatientChart } from "../../src/types/clinical";
import "../../src/styles.css";
const chart = {
  patient: {
    id: "fictional-patient",
    first_name: "Testna",
    last_name: "Osoba",
    patient_number: "TEST-1",
  },
} as PatientChart;
createRoot(document.getElementById("root")!).render(
  <ClinicalModal
    action="therapy"
    chart={chart}
    onClose={() => {}}
    onSaved={() => {
      document.getElementById("root")!.textContent = "Terapija spremljena";
    }}
  />,
);
