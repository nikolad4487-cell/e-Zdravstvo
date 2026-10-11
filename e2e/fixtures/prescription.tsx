import { createRoot } from "react-dom/client";
import { IssueDocumentModal } from "../../src/components/medical/IssueDocumentModal";
import type { PatientChart } from "../../src/types/clinical";
import "../../src/styles.css";
const chart = {
  patient: {
    id: "60000000-0000-4000-8000-000000000100",
    patient_number: "TEST-100",
    first_name: "Testna",
    last_name: "Osoba",
    birth_date: "2000-01-01",
  },
  encounters: [],
} as PatientChart;
createRoot(document.getElementById("root")!).render(
  <IssueDocumentModal
    kind="PRESCRIPTION"
    chart={chart}
    onClose={() => {}}
    onSaved={() => {
      document.getElementById("root")!.textContent = "Recept izdan";
    }}
  />,
);
