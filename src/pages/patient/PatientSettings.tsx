import { useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../hooks/useResource";
import { useAuth } from "../../hooks/useAuth";
import { mySettings, myAccessHistory } from "../../services/patientSettings";
import { db } from "../../lib/supabase";
import { unwrap } from "../../services/clinical";
import { Field, values } from "../../components/ui/Fields";
import { ErrorMessage } from "../../components/ui/Feedback";
import { Modal } from "../../components/ui/Modal";
import { dateLabel, readableError } from "../../utils/format";
export function PatientSettings() {
  const resource = useResource(mySettings, "patient-settings"),
    auth = useAuth(),
    [page, setPage] = useState(0),
    [showHistory, setShowHistory] = useState(false),
    [modal, setModal] = useState<"contacts" | "sessions" | null>(null),
    [access, setAccess] = useState<{
      user_id: string;
      name: string;
      allowed: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const history = useResource(
    async () => (showHistory ? myAccessHistory(page) : []),
    String(showHistory) + page,
  );
  async function contacts(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("save_patient_contacts", {
          data: values(e.currentTarget),
        }),
      );
      setModal(null);
      resource.refresh();
      setSuccess("Kontaktni podaci su spremljeni.");
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    setBusy(true);
    setError("");
    try {
      if (access) {
        unwrap(
          await db().rpc("set_my_care_access", {
            target_user: access.user_id,
            allowed: !access.allowed,
          }),
        );
        setAccess(null);
        resource.refresh();
        setSuccess("Postavka pristupa je spremljena.");
      } else {
        const result = await db().auth.signOut({ scope: "others" });
        if (result.error) throw result.error;
        setModal(null);
        setSuccess(
          "Odjavljene su druge sesije. Već izdani pristupni tokeni vrijede do isteka.",
        );
      }
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  if (resource.loading) return <p role="status">Učitavanje postavki…</p>;
  if (resource.error) return <ErrorMessage>{resource.error}</ErrorMessage>;
  if (!resource.data)
    return (
      <section className="card empty-state">
        Račun još nije povezan s kartonom.
      </section>
    );
  const { patient: p, team } = resource.data;
  return (
    <>
      <div className="page-heading">
        <div>
          <h2>Postavke</h2>
          <p>Osobni kontakti, pristup skrbnog tima i sigurnost računa.</p>
        </div>
      </div>
      {success && (
        <p role="status" className="success-toast">
          {success}
        </p>
      )}
      <div className="account-grid">
        <section className="card">
          <h3>Vaš profil</h3>
          <p>
            <strong>{p.name}</strong>
          </p>
          <p>
            {dateLabel(p.birth_date)} · {p.patient_number}
          </p>
          <p>{p.email || "Kontaktni e-mail nije naveden"}</p>
          <p>{p.phone || "Telefon nije naveden"}</p>
          <p>
            {[p.address, p.city, p.postal_code].filter(Boolean).join(", ") ||
              "Adresa nije navedena"}
          </p>
          <p>
            Kontakt za hitne slučajeve: {p.emergency_contact || "Nije naveden"}
          </p>
          <button
            className="secondary"
            onClick={() => {
              setError("");
              setModal("contacts");
            }}
          >
            Uredi kontaktne podatke
          </button>
        </section>
        <section className="card">
          <h3>Pristup skrbnog tima kartonu</h3>
          <p>
            Možete ograničiti pristup dodijeljenim liječnicima i sestrama.
            Ponovno dopuštenje vrijedi samo dok postoji važeća skrbna ovlast.
          </p>
          {team.map((t) => (
            <div className="renewal-row" key={t.user_id}>
              <div>
                <strong>{t.name}</strong>
                <p>
                  {t.role === "DOCTOR"
                    ? "Liječnik"
                    : "Medicinska sestra / tehničar"}{" "}
                  · {t.allowed ? "Pristup dopušten" : "Pristup ograničen"}
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => {
                  setError("");
                  setAccess(t);
                }}
              >
                {t.allowed ? "Ograniči" : "Dopusti"}
              </button>
            </div>
          ))}
          {!team.length && <p>Nema aktivnih članova skrbnog tima.</p>}
          <p className="muted">
            Ovo ograničava pristup kartonu u ovoj aplikaciji. Već izdani nalazi
            autora, obrada laboratorijskih zahtjeva i pojedinačnih bolničkih
            narudžbi imaju zasebne ovlasti.
          </p>
        </section>
        <section className="card">
          <h3>Sigurnost i prijave</h3>
          <p>E-mail za prijavu: {auth.session?.user.email}</p>
          <Link className="secondary" to="/nova-lozinka">
            Promijeni lozinku
          </Link>
          <button
            className="secondary spaced"
            onClick={() => {
              setError("");
              setModal("sessions");
            }}
          >
            Odjavi druge uređaje
          </button>
          <p className="muted">
            Odjava uklanja druge sesije za obnovu prijave. Pristupni tokeni koji
            su već izdani ostaju valjani do isteka.
          </p>
          <h3>Obavijesti</h3>
          <p>
            Obavijesti o dokumentima, porukama i narudžbama dostupne su u
            portalu. Slanje e-poštom nije uključeno.
          </p>
        </section>
      </div>
      <section className="card spaced">
        <div className="section-heading">
          <h3>Pregled pristupa kartonu</h3>
          <button
            className="secondary"
            onClick={() => {
              setShowHistory(true);
              history.refresh();
            }}
          >
            Prikaži pristupe
          </button>
        </div>
        {history.error && <ErrorMessage>{history.error}</ErrorMessage>}
        {showHistory &&
          (history.loading ? (
            <p role="status">Učitavanje evidencije…</p>
          ) : (
            <>
              <p className="muted">
                Evidentirani pojedinačni pregledi i preuzimanja povezana s vašim
                kartonom. Zajednički popisi bez identifikatora pacijenta nisu
                uključeni u ovaj prikaz.
              </p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Vrijeme</th>
                      <th>Korisnik</th>
                      <th>Radnja</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.data?.map((a) => (
                      <tr key={a.id}>
                        <td>
                          {new Date(a.created_at).toLocaleString("hr-HR", {
                            timeZone: "Europe/Zagreb",
                          })}
                        </td>
                        <td>{a.actor}</td>
                        <td>{a.action}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!history.data?.length && <p>Nema događaja na ovoj stranici.</p>}
              <div className="document-actions">
                <button
                  className="secondary"
                  disabled={!page}
                  onClick={() => setPage(page - 1)}
                >
                  Prethodna
                </button>
                <span>Stranica {page + 1}</span>
                <button
                  className="secondary"
                  disabled={history.data?.length !== 50}
                  onClick={() => setPage(page + 1)}
                >
                  Sljedeća
                </button>
              </div>
            </>
          ))}
      </section>
      {modal === "contacts" && (
        <Modal
          title="Kontaktni podaci"
          busy={busy}
          onClose={() => setModal(null)}
        >
          <form onSubmit={contacts}>
            <div className="form-grid">
              {[
                ["phone", "Telefon"],
                ["email", "Kontaktni e-mail"],
                ["address", "Adresa"],
                ["city", "Grad"],
                ["postal_code", "Poštanski broj"],
                ["emergency_contact", "Kontakt za hitne slučajeve"],
              ].map(([key, label]) => (
                <Field
                  key={key}
                  name={key}
                  label={label}
                  type={key === "email" ? "email" : "text"}
                  defaultValue={p[key as "phone"] ?? ""}
                  maxLength={
                    key === "emergency_contact"
                      ? 500
                      : key === "address"
                        ? 300
                        : key === "email"
                          ? 254
                          : key === "city"
                            ? 150
                            : key === "phone"
                              ? 50
                              : 20
                  }
                />
              ))}
            </div>
            <p>Kontaktni e-mail ne mijenja e-mail za prijavu.</p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                Spremi kontakte
              </button>
            </div>
          </form>
        </Modal>
      )}
      {(access || modal === "sessions") && (
        <Modal
          title={access ? "Promjena pristupa" : "Odjava drugih uređaja"}
          busy={busy}
          onClose={() => {
            setAccess(null);
            setModal(null);
          }}
        >
          <div className="modal-content">
            <p className="confirm-box">
              {access
                ? `${access.allowed ? "Ograničiti" : "Ponovno dopustiti"} pristup kartonu za ${access.name}? Promjena se primjenjuje na nove zahtjeve u aplikaciji i može utjecati na rad vašeg skrbnog tima.`
                : "Druge sesije više se neće moći obnoviti. Trenutačna prijava ostaje aktivna."}
            </p>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <button
              className="primary"
              disabled={busy}
              onClick={() => void confirm()}
            >
              Potvrdi promjenu
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
