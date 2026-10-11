import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../../src/contexts/AuthContext";
import { LaboratoryPanel } from "../../src/components/medical/LaboratoryPanel";
import "../../src/styles.css";

createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <main className="page-content">
        <LaboratoryPanel mode="LAB" />
      </main>
    </AuthProvider>
  </BrowserRouter>,
);
