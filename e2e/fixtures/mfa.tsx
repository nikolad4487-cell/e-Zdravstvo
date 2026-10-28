import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "../../src/contexts/AuthContext";
import {
  AccountSecurityPage,
  MfaChallengePage,
} from "../../src/pages/auth/AccountSecurityPage";
import "../../src/styles.css";
const enrollment = new URLSearchParams(location.search).has("enroll");
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthProvider>
      <Routes>
        <Route
          path="/e2e/fixtures/mfa.html"
          element={enrollment ? <AccountSecurityPage /> : <MfaChallengePage />}
        />
        <Route
          path="/ordinacija"
          element={<p role="status">Prijava potvrđena.</p>}
        />
      </Routes>
    </AuthProvider>
  </BrowserRouter>,
);
