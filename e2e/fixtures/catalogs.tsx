import { createRoot } from "react-dom/client";
import { MedicalCodesPage } from "../../src/pages/shared/MedicalCodesPage";
import "../../src/styles.css";
createRoot(document.getElementById("root")!).render(
  <main className="main-content">
    <MedicalCodesPage />
  </main>,
);
