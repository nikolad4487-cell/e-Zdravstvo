import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "../../src/contexts/AuthContext";
import { CarePathways } from "../../src/components/medical/CarePathways";
import "../../src/styles.css";
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <main className="page-content">
        <CarePathways />
      </main>
    </AuthProvider>
  </BrowserRouter>,
);
