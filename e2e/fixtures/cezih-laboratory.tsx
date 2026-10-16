import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../../src/contexts/AuthContext";
import { LaboratoryPanel } from "../../src/components/medical/LaboratoryPanel";
import "../../src/styles.css";
const mode =
  new URLSearchParams(location.search).get("mode") === "LAB" ? "LAB" : "CARE";
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <main className="page-content">
        <LaboratoryPanel
          mode={mode}
          patientId="fictional-patient"
          canOrder={mode === "CARE"}
        />
      </main>
    </AuthProvider>
  </BrowserRouter>,
);
