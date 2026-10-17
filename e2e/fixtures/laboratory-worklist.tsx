import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../../src/contexts/AuthContext";
import { LaboratoryWorkspace } from "../../src/components/medical/LaboratoryWorklist";
import "../../src/styles.css";
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <main className="page-content">
        <LaboratoryWorkspace />
      </main>
    </AuthProvider>
  </BrowserRouter>,
);
