import { Navigate, Outlet, Route, Routes, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { homeFor, canAccess } from "../lib/roles";
import { Loading, ErrorMessage } from "../components/ui/Feedback";
import { LoginPage } from "../pages/auth/LoginPage";
import { PasswordPage } from "../pages/auth/PasswordPage";
import { PortalLayout } from "../layouts/PortalLayout";
import { PortalHome } from "../pages/PortalHome";
import { InformationPage } from "../pages/InformationPage";
import { PatientsPage } from "../pages/doctor/PatientsPage";
import { PatientRecordPage } from "../pages/doctor/PatientRecordPage";
import { InstitutionPage } from "../pages/institution/InstitutionPage";
import { DoctorHome } from "../pages/doctor/DoctorHome";
import { PatientHome } from "../pages/patient/PatientHome";
import { SchoolPage } from "../pages/school/SchoolPage";
import { VerificationPage } from "../pages/VerificationPage";
import { AuditPage } from "../pages/admin/AuditPage";
import { AppointmentPanel } from "../components/medical/AppointmentPanel";
import { LaboratoryPanel } from "../components/medical/LaboratoryPanel";
import { CentralHome } from "../pages/admin/CentralHome";
import { UsersPage } from "../pages/admin/UsersPage";
import { CareTeamsPage } from "../pages/admin/CareTeamsPage";
import { AdministrationPage } from "../pages/admin/AdministrationPage";
import { HospitalAdminPage } from "../pages/institution/HospitalAdminPage";
import { HospitalBookings } from "../components/medical/HospitalBookings";
import { CommunicationPanel } from "../components/medical/CommunicationPanel";
import { RenewalPanel } from "../components/medical/RenewalPanel";
import { MedicalReports } from "../components/medical/MedicalReports";
import { PharmacyPanel } from "../components/medical/PharmacyPanel";
function Guard({ path }: { path?: string }) {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (!auth.session) return <Navigate to="/prijava" replace />;
  if (auth.recovery || auth.profile?.must_change_password)
    return <Navigate to="/nova-lozinka" replace />;
  if (auth.error)
    return (
      <main className="standalone">
        <ErrorMessage>{auth.error}</ErrorMessage>
        <button className="primary" onClick={auth.refresh}>
          Pokušaj ponovno
        </button>
        <Link to="/zaboravljena-lozinka">Obnova pristupa</Link>
      </main>
    );
  if (path && !canAccess(path, auth.roles))
    return <Navigate to="/bez-pristupa" replace />;
  return <Outlet />;
}
function Home() {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  return (
    <Navigate to={auth.session ? homeFor(auth.roles) : "/prijava"} replace />
  );
}
function NoAccess() {
  const auth = useAuth();
  return (
    <main className="standalone">
      <h1>Pristup nije dodijeljen.</h1>
      <p>
        Za ovaj portal potrebna je odgovarajuća uloga. Obratite se
        administratoru ustanove.
      </p>
      {auth.roles.length > 0 && (
        <Link to={homeFor(auth.roles)}>Otvori moj portal</Link>
      )}
      <button className="primary" onClick={auth.refresh}>
        Osvježi ovlasti
      </button>
      <button
        className="secondary"
        onClick={() =>
          void auth.signOut().catch(() => window.location.reload())
        }
      >
        Odjavi se
      </button>
    </main>
  );
}
export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/verify/:token" element={<VerificationPage />} />
      <Route path="/prijava" element={<LoginPage />} />
      <Route path="/zaboravljena-lozinka" element={<PasswordPage />} />
      <Route path="/nova-lozinka" element={<PasswordPage reset />} />
      <Route path="/postavljanje" element={<InformationPage kind="setup" />} />
      <Route path="/privatnost" element={<InformationPage kind="privacy" />} />
      <Route path="/o-sustavu" element={<InformationPage kind="about" />} />
      <Route element={<Guard />}>
        <Route path="/bez-pristupa" element={<NoAccess />} />
      </Route>
      {[
        "/ordinacija",
        "/moje",
        "/central",
        "/ustanove",
        "/ljekarna",
        "/laboratorij",
        "/skola",
      ].map((path) => (
        <Route key={path} element={<Guard path={path} />}>
          <Route element={<PortalLayout />}>
            {(path === "/central" || path === "/ustanove") && (
              <Route
                path={path + "/bolnicki-termini"}
                element={<HospitalAdminPage />}
              />
            )}
            {path === "/ordinacija" && (
              <>
                <Route
                  path="/ordinacija/komunikacija"
                  element={<CommunicationPanel />}
                />
                <Route path="/ordinacija/obnova" element={<RenewalPanel />} />
                <Route
                  path="/ordinacija/narudzbe"
                  element={<HospitalBookings mode="CARE" />}
                />
                <Route
                  path="/ordinacija/bolnica"
                  element={<HospitalBookings mode="PROVIDER" />}
                />
              </>
            )}
            <Route
              path={path}
              element={
                path === "/ustanove" ? (
                  <InstitutionPage />
                ) : path === "/ordinacija" ? (
                  <DoctorHome />
                ) : path === "/moje" ? (
                  <PatientHome />
                ) : path === "/central" ? (
                  <CentralHome />
                ) : path === "/laboratorij" ? (
                  <LaboratoryPanel mode="LAB" />
                ) : path === "/ljekarna" ? (
                  <PharmacyPanel />
                ) : path === "/skola" ? (
                  <SchoolPage />
                ) : (
                  <PortalHome />
                )
              }
            />
            {path === "/central" && (
              <>
                <Route path="/central/audit" element={<AuditPage />} />
                <Route
                  path="/central/skrbni-timovi"
                  element={<CareTeamsPage />}
                />
                <Route path="/central/korisnici" element={<UsersPage />} />
                <Route path="/central/ustanove" element={<InstitutionPage />} />
                <Route
                  path="/central/ambulante"
                  element={<AdministrationPage mode="clinics" />}
                />
                <Route
                  path="/central/predlosci"
                  element={<AdministrationPage mode="templates" />}
                />
                <Route
                  path="/central/sifrarnici"
                  element={<AdministrationPage mode="catalog" />}
                />
              </>
            )}
            {path === "/ustanove" && (
              <>
                <Route
                  path="/ustanove/skrbni-timovi"
                  element={<CareTeamsPage />}
                />
                <Route
                  path="/ustanove/ambulante"
                  element={<AdministrationPage mode="clinics" />}
                />
                <Route
                  path="/ustanove/predlosci"
                  element={<AdministrationPage mode="templates" />}
                />
              </>
            )}
            {path === "/ordinacija" && (
              <>
                <Route
                  path="/ordinacija/laboratorij"
                  element={<LaboratoryPanel mode="CARE" />}
                />
                <Route path="/ordinacija/nalazi" element={<MedicalReports />} />
                <Route
                  path="/ordinacija/termini"
                  element={<AppointmentPanel />}
                />
                <Route
                  path="/ordinacija/cekaonica"
                  element={<AppointmentPanel waiting />}
                />
                <Route
                  path="/ordinacija/pacijenti"
                  element={<PatientsPage />}
                />
                <Route
                  path="/ordinacija/pacijenti/:id"
                  element={<PatientRecordPage />}
                />
              </>
            )}
          </Route>
        </Route>
      ))}
      <Route
        path="*"
        element={
          <main className="standalone">
            <h1>Stranica nije pronađena.</h1>
            <Link to="/">Povratak na početnu</Link>
          </main>
        }
      />
    </Routes>
  );
}
