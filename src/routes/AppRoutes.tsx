import { Navigate, Outlet, Route, Routes, Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { homeFor, canAccess } from "../lib/roles";
import { Loading, ErrorMessage } from "../components/ui/Feedback";
import { LoginPage } from "../pages/auth/LoginPage";
import { PasswordPage } from "../pages/auth/PasswordPage";
import { PortalLayout } from "../layouts/PortalLayout";
import { PortalHome } from "../pages/PortalHome";
import { InformationPage } from "../pages/InformationPage";
function Guard({ path }: { path?: string }) {
  const auth = useAuth();
  if (auth.loading) return <Loading />;
  if (!auth.session) return <Navigate to="/prijava" replace />;
  if (auth.recovery) return <Navigate to="/nova-lozinka" replace />;
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
            <Route path={path} element={<PortalHome />} />
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
