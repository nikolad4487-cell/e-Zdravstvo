import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthContext } from "../../src/contexts/AuthContext";
import { PortalLayout } from "../../src/layouts/PortalLayout";
import type { UserRole } from "../../src/types";
import "../../src/styles.css";
function Fixture() {
  const [signedOut, setSignedOut] = useState(false);
  const patient = new URLSearchParams(location.search).has("patient");
  const roles: UserRole[] = patient
    ? ["PATIENT", "DOCTOR", "INSTITUTION_ADMIN"]
    : ["DOCTOR", "INSTITUTION_ADMIN"];
  return (
    <AuthContext.Provider
      value={{
        session: null,
        profile: {
          id: "fixture",
          first_name: "Testna",
          last_name: "Osoba",
          is_demo: true,
          must_change_password: false,
          created_at: "2026-01-01",
          updated_at: "2026-01-01",
        },
        roles,
        institutions: [],
        loading: false,
        error: "",
        recovery: false,
        signIn: async () => {},
        signOut: async () => setSignedOut(true),
        refresh: () => {},
      }}
    >
      <MemoryRouter initialEntries={[patient ? "/moje" : "/ordinacija"]}>
        <Routes>
          <Route element={<PortalLayout />}>
            <Route
              path="*"
              element={
                <>
                  {signedOut && <p role="status">Odjava potvrđena</p>}
                  <section className="patient-header card">
                    <div className="avatar large">TO</div>
                    <div>
                      <h1>Testna Osoba</h1>
                      <p>Karton testnog pacijenta</p>
                    </div>
                    <div className="patient-actions">
                      <button>Uredi pacijenta</button>
                      <button>Novi pregled</button>
                      <button>Naruči prioritetni pregled</button>
                    </div>
                  </section>
                  <nav className="record-tabs" aria-label="Dijelovi kartona">
                    {[
                      "PREGLED",
                      "POVIJEST",
                      "DIJAGNOZE",
                      "TERAPIJA",
                      "OBNOVA LIJEKOVA",
                      "RECEPTI",
                      "UPUTNICE",
                      "ISPRIČNICE",
                      "DOKUMENTI",
                      "TERMINI",
                      "NARUDŽBE",
                      "LABORATORIJ",
                      "NALAZI",
                      "CIJEPLJENJA",
                    ].map((t) => (
                      <button key={t}>{t}</button>
                    ))}
                  </nav>
                  <div className="account-grid">
                    {[
                      "Podaci pacijenta",
                      "Tim koji skrbi o pacijentu",
                      "Aktivna terapija",
                      "Kronične bolesti i alergije",
                    ].map((t) => (
                      <section className="card" key={t}>
                        <h2>{t}</h2>
                        <p>Testni sadržaj</p>
                      </section>
                    ))}
                  </div>
                  <div style={{ height: 1000 }}>
                    Sadržaj za provjeru pomicanja stranice
                  </div>
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
