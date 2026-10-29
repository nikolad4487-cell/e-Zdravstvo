import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthContext } from "../../src/contexts/AuthContext";
import { InpatientCare } from "../../src/components/medical/InpatientCare";
import "../../src/styles.css";
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <AuthContext.Provider
      value={{
        session: null,
        profile: { id: "staff-test" } as never,
        roles: ["DOCTOR"],
        institutions: [],
        loading: false,
        error: "",
        recovery: false,
        mfaRequired: false,
        signIn: async () => {},
        signOut: async () => {},
        refresh() {},
      }}
    >
      <main className="page-content">
        <InpatientCare patientId="patient-test" patientName="Testna Osoba" />
      </main>
    </AuthContext.Provider>
  </BrowserRouter>,
);
