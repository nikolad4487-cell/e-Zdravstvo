import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  ArrowUpRight,
  Building2,
  ChevronDown,
  Home,
  LogOut,
  Menu,
  ShieldCheck,
  X,
  Users,
} from "lucide-react";
import { StatusBadge } from "../components/ui/StatusBadge";
import { Brand } from "../components/ui/Brand";
import { Disclaimer, ErrorMessage } from "../components/ui/Feedback";
import { useAuth } from "../hooks/useAuth";
import { portals, roleLabels } from "../lib/roles";
import { GlobalSearch } from "../components/medical/GlobalSearch";
export function PortalLayout() {
  const auth = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const available = portals.filter(
    (p, i, all) =>
      auth.roles.includes(p.role) &&
      all.findIndex((q) => q.path === p.path && auth.roles.includes(q.role)) ===
        i,
  );
  const active = available.find((p) => location.pathname.startsWith(p.path));
  async function logout() {
    setBusy(true);
    try {
      await auth.signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Odjava nije uspjela.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="portal">
      <button
        className="mobile-menu"
        aria-label="Otvori navigaciju"
        onClick={() => setOpen(!open)}
      >
        {open ? <X /> : <Menu />}
      </button>
      {open && (
        <button
          className="sidebar-backdrop"
          aria-label="Zatvori navigaciju"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <Brand />
        <div className="workspace-label">RADNI PROSTOR</div>
        <div className="workspace-current">
          <Building2 size={19} />
          <span>{active?.title ?? "e-Zdravstvo"}</span>
          <ChevronDown size={15} />
        </div>
        <nav>
          <NavLink to={active?.path ?? "/"} end onClick={() => setOpen(false)}>
            <Home size={19} />
            Početna
          </NavLink>
          {active?.path === "/ordinacija" && (
            <>
              <NavLink to="/ordinacija/narudzbe" onClick={() => setOpen(false)}>
                <Building2 size={19} />
                Bolničke narudžbe
              </NavLink>
              <NavLink to="/ordinacija/bolnica" onClick={() => setOpen(false)}>
                <Users size={19} />
                Moji bolnički pacijenti
              </NavLink>
              <NavLink
                to="/ordinacija/pacijenti"
                onClick={() => setOpen(false)}
              >
                <Users size={19} />
                Pacijenti
              </NavLink>
              <NavLink to="/ordinacija/termini" onClick={() => setOpen(false)}>
                <Home size={19} />
                Termini
              </NavLink>
              <NavLink
                to="/ordinacija/laboratorij"
                onClick={() => setOpen(false)}
              >
                <ShieldCheck size={19} />
                Laboratorij
              </NavLink>
              <NavLink
                to="/ordinacija/cekaonica"
                onClick={() => setOpen(false)}
              >
                <Users size={19} />
                Čekaonica
              </NavLink>
            </>
          )}
        </nav>
        {active?.path === "/central" && (
          <nav>
            <NavLink
              to="/central/bolnicki-termini"
              onClick={() => setOpen(false)}
            >
              Bolničke usluge i termini
            </NavLink>
            <NavLink to="/central/skrbni-timovi" onClick={() => setOpen(false)}>
              <Users size={19} />
              Skrbni timovi
            </NavLink>
            {[
              "korisnici",
              "ustanove",
              "ambulante",
              "predlosci",
              "sifrarnici",
            ].map((p, i) => (
              <NavLink
                key={p}
                to={"/central/" + p}
                onClick={() => setOpen(false)}
              >
                <Building2 size={19} />
                {
                  [
                    "Korisnici i ovlasti",
                    "Ustanove",
                    "Ambulante i liječnici",
                    "Predlošci ispričnica",
                    "Šifrarnici",
                  ][i]
                }
              </NavLink>
            ))}
            <NavLink to="/central/audit" onClick={() => setOpen(false)}>
              <ShieldCheck size={19} />
              Audit događaji
            </NavLink>
          </nav>
        )}
        {active?.path === "/ustanove" && (
          <nav>
            <NavLink
              to="/ustanove/bolnicki-termini"
              onClick={() => setOpen(false)}
            >
              Bolničke usluge i termini
            </NavLink>
            <NavLink to="/ustanove/skrbni-timovi">Skrbni timovi</NavLink>
            <NavLink to="/ustanove/ambulante">Ambulante i liječnici</NavLink>
            <NavLink to="/ustanove/predlosci">Predlošci ispričnica</NavLink>
          </nav>
        )}
        {available.length > 1 && (
          <>
            <div className="workspace-label">MOJI PORTALI</div>
            <nav>
              {available.map((p) => (
                <NavLink
                  key={p.path}
                  to={p.path}
                  onClick={() => setOpen(false)}
                >
                  <ArrowUpRight size={17} />
                  {p.title.replace("e-Zdravstvo ", "")}
                </NavLink>
              ))}
            </nav>
          </>
        )}
        <div className="sidebar-note">
          <ShieldCheck size={22} />
          <strong>Temelj za povezanu skrb</strong>
          <p>Pristup kartonima dostupan je samo ovlaštenim članovima tima.</p>
          <Link to="/o-sustavu">
            O razvojnoj verziji <ArrowUpRight size={13} />
          </Link>
        </div>
        <div className="sidebar-user">
          <div className="avatar">
            {auth.profile?.first_name[0]}
            {auth.profile?.last_name[0]}
          </div>
          <div>
            <strong>
              {auth.profile?.first_name} {auth.profile?.last_name}
            </strong>
            <span>{active ? roleLabels[active.role] : "Korisnik"}</span>
          </div>
        </div>
        <p className="institution-name">
          {auth.institutions.map((i) => i.name).join(", ") ||
            "Osobni radni prostor"}
        </p>
        <button
          className="logout"
          onClick={() => void logout()}
          disabled={busy}
        >
          <LogOut size={17} />
          {busy ? "Odjava…" : "Odjavi se"}
        </button>
      </aside>
      <div className="portal-body">
        <header className="portal-top">
          {active?.path === "/ordinacija" ? (
            <GlobalSearch />
          ) : (
            <span>{active?.title}</span>
          )}
          <span>
            {auth.profile?.is_demo ? (
              <StatusBadge status="DEMO" />
            ) : (
              <>
                <span className="tiny-dot" /> Razvojno okruženje
              </>
            )}
          </span>
        </header>
        <main className="portal-main">
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <Outlet />
        </main>
        <footer className="portal-footer">
          <Disclaimer />
        </footer>
      </div>
    </div>
  );
}
