import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { getAdminConfiguration } from "../../services/admin";
import { unwrap } from "../../services/clinical";
import { db } from "../../lib/supabase";
import { Field, values } from "../../components/ui/Fields";
import { Modal } from "../../components/ui/Modal";
import { ErrorMessage } from "../../components/ui/Feedback";
import { readableError } from "../../utils/format";
import type { AdminConfiguration, ExcuseTemplate } from "../../types/admin";

type Edit = {
  kind: "clinic" | "doctor" | "reason" | "diagnosis";
  id: string | null;
};
export function AdministrationPage({
  mode,
}: {
  mode: "clinics" | "templates" | "catalog";
}) {
  const resource = useResource(getAdminConfiguration, "admin-" + mode),
    [org, setOrg] = useState(""),
    [edit, setEdit] = useState<Edit | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const data = resource.data,
    institution = org || data?.institutions[0]?.id || "";
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!edit) return;
    const fields = values(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (edit.kind === "clinic")
        unwrap(
          await db().rpc("save_clinic", {
            institution_id: institution,
            clinic_id: edit.id,
            data: { ...fields, active: fields.active === "true" },
          }),
        );
      else if (edit.kind === "doctor")
        unwrap(
          await db().rpc("save_doctor_identity", {
            doctor_id: edit.id!,
            data: fields,
          }),
        );
      else
        unwrap(
          await db().rpc("save_excuse_catalog", {
            catalog: edit.kind,
            entry_id: edit.id,
            data: { ...fields, active: fields.active === "true" },
          }),
        );
      setEdit(null);
      setSuccess("Promjene su spremljene.");
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  function open(kind: Edit["kind"], id: string | null) {
    setError("");
    setSuccess("");
    setEdit({ kind, id });
  }
  const clinic = data?.clinics.find((c) => c.id === edit?.id),
    doctor = data?.doctors.find((d) => d.id === edit?.id),
    entry = (edit?.kind === "reason" ? data?.reasons : data?.diagnoses)?.find(
      (d) => d.id === edit?.id,
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">POSTAVKE USTANOVE</div>
          <h1>
            {mode === "clinics"
              ? "Ambulante i liječnici"
              : mode === "templates"
                ? "Predlošci ispričnica"
                : "Dijagnoze i razlozi izostanka"}
          </h1>
          <p>
            {mode === "templates"
              ? "Zaseban predložak za redovnu nastavu i tjelesnu i zdravstvenu kulturu."
              : "Podaci izdavatelja i šifrarnici za izdavanje dokumenata."}
          </p>
        </div>
      </div>
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {resource.loading && <p role="status">Učitavanje postavki…</p>}
      {success && (
        <p className="feedback success" role="status">
          {success}
        </p>
      )}
      {data && (
        <>
          {mode !== "catalog" && (
            <label className="field">
              <span>Ustanova</span>
              <select
                value={institution}
                onChange={(e) => setOrg(e.target.value)}
              >
                {data.institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "clinics" && (
            <>
              <section className="card institution-section spaced">
                <div className="section-heading">
                  <h2>Ambulante</h2>
                  <button
                    className="primary"
                    disabled={!institution}
                    onClick={() => open("clinic", null)}
                  >
                    Nova ambulanta
                  </button>
                </div>
                {data.clinics
                  .filter((c) => c.institution_id === institution)
                  .map((c) => (
                    <div className="admin-row" key={c.id}>
                      <div>
                        <strong>{c.name}</strong>
                        <p>
                          {c.code} · {c.address}, {c.city}
                        </p>
                        <small>
                          {c.phone} · {c.email} ·{" "}
                          {c.active ? "Aktivna" : "Neaktivna"}
                        </small>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => open("clinic", c.id)}
                      >
                        Uredi
                      </button>
                    </div>
                  ))}
                {!data.clinics.some(
                  (c) => c.institution_id === institution,
                ) && (
                  <p>
                    Još nema ambulanti. Dodajte podatke koji će se prikazivati
                    na dokumentima.
                  </p>
                )}
              </section>
              <section className="card institution-section">
                <h2>Liječnici i osobne oznake potpisa</h2>
                <p className="muted">
                  Svaki liječnik ima vlastitu trajnu oznaku internog potpisa.
                  Privatni ključ ostaje u bazi podataka.
                </p>
                {data.doctors
                  .filter((d) => d.institution_id === institution)
                  .map((d) => (
                    <div className="admin-row" key={d.id}>
                      <div>
                        <strong>{d.display_name}</strong>
                        <p>
                          Šifra liječnika: {d.doctor_code || "Nije unesena"} ·{" "}
                          {data.clinics.find((c) => c.id === d.clinic_id)
                            ?.name || "Ambulanta nije odabrana"}
                        </p>
                        <code>{d.signer_fingerprint}</code>
                      </div>
                      <button
                        className="secondary"
                        onClick={() => open("doctor", d.id)}
                      >
                        Uredi liječnika
                      </button>
                    </div>
                  ))}
              </section>
            </>
          )}
          {mode === "templates" &&
            data.templates
              .filter((t) => t.institution_id === institution)
              .map((t) => (
                <TemplateEditor
                  key={t.institution_id + t.excuse_type + t.version}
                  template={t}
                  config={data}
                  saved={() => {
                    setSuccess("Nova verzija predloška je spremljena.");
                    resource.refresh();
                  }}
                />
              ))}
          {mode === "catalog" &&
            (["reason", "diagnosis"] as const).map((kind) => (
              <section className="card institution-section" key={kind}>
                <div className="section-heading">
                  <h2>
                    {kind === "reason" ? "Razlozi izostanka" : "Šifre bolesti"}
                  </h2>
                  <button className="primary" onClick={() => open(kind, null)}>
                    Dodaj {kind === "reason" ? "razlog" : "dijagnozu"}
                  </button>
                </div>
                <p className="muted">
                  {kind === "diagnosis"
                    ? "Označite sustav kodiranja točno prema izvoru šifrarnika. Lokalni i testni kodovi nisu službena MKB klasifikacija."
                    : "Neaktivni razlozi ostaju zabilježeni na već izdanim dokumentima."}
                </p>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Šifra</th>
                        <th>Naziv</th>
                        <th>Status</th>
                        <th>Radnja</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(kind === "reason" ? data.reasons : data.diagnoses).map(
                        (r) => (
                          <tr key={r.id}>
                            <td>
                              {r.code}
                              {r.coding_system && (
                                <small> · {r.coding_system}</small>
                              )}
                            </td>
                            <td>{r.name}</td>
                            <td>{r.active ? "Aktivno" : "Neaktivno"}</td>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => open(kind, r.id)}
                              >
                                Uredi
                              </button>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
        </>
      )}
      {edit && (
        <Modal
          title={
            edit.kind === "clinic"
              ? "Podaci ambulante"
              : edit.kind === "doctor"
                ? "Podaci liječnika"
                : "Stavka šifrarnika"
          }
          busy={busy}
          onClose={() => setEdit(null)}
        >
          <form onSubmit={submit}>
            <div className="form-grid">
              {edit.kind === "clinic" ? (
                <>
                  <Field
                    name="name"
                    label="Naziv ambulante"
                    defaultValue={clinic?.name}
                    required
                    minLength={2}
                    maxLength={200}
                  />
                  <Field
                    name="code"
                    label="Šifra ambulante"
                    defaultValue={clinic?.code}
                    required
                    maxLength={40}
                  />
                  <Field
                    name="address"
                    label="Adresa"
                    defaultValue={clinic?.address}
                    maxLength={300}
                  />
                  <Field
                    name="city"
                    label="Grad"
                    defaultValue={clinic?.city}
                    maxLength={100}
                  />
                  <Field
                    name="phone"
                    label="Telefon"
                    defaultValue={clinic?.phone}
                    maxLength={50}
                  />
                  <Field
                    name="email"
                    type="email"
                    label="E-mail"
                    defaultValue={clinic?.email}
                    maxLength={200}
                  />
                </>
              ) : edit.kind === "doctor" ? (
                <>
                  <Field
                    name="display_name"
                    label="Ime i prezime liječnika"
                    defaultValue={doctor?.display_name}
                    required
                    minLength={3}
                    maxLength={200}
                  />
                  <Field
                    name="doctor_code"
                    label="Šifra liječnika"
                    defaultValue={doctor?.doctor_code}
                    required
                    maxLength={40}
                  />
                  <Field
                    name="specialty"
                    label="Specijalnost"
                    defaultValue={doctor?.specialty}
                    maxLength={200}
                  />
                  <Field
                    name="clinic_id"
                    label="Ambulanta"
                    defaultValue={doctor?.clinic_id ?? ""}
                  >
                    <option value="">Bez zadane ambulante</option>
                    {data?.clinics
                      .filter(
                        (c) => c.institution_id === institution && c.active,
                      )
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Field>
                </>
              ) : (
                <>
                  {!edit.id && (
                    <Field name="code" label="Šifra" required maxLength={40} />
                  )}
                  <Field
                    name="name"
                    label="Naziv"
                    defaultValue={entry?.name}
                    required
                    minLength={2}
                    maxLength={200}
                  />
                  {edit.kind === "diagnosis" && !edit.id && (
                    <Field
                      name="coding_system"
                      label="Sustav kodiranja"
                      defaultValue="LOCAL"
                      required
                      maxLength={40}
                    />
                  )}
                </>
              )}
              {edit.kind !== "doctor" && (
                <Field
                  name="active"
                  label="Status"
                  defaultValue={
                    (clinic?.active ?? entry?.active ?? true) ? "true" : "false"
                  }
                >
                  <option value="true">Aktivno</option>
                  <option value="false">Neaktivno</option>
                </Field>
              )}
            </div>
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <div className="modal-actions">
              <button className="primary" disabled={busy}>
                {busy ? "Spremanje…" : "Spremi"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function TemplateEditor({
  template,
  config,
  saved,
}: {
  template: ExcuseTemplate;
  config: AdminConfiguration;
  saved: () => void;
}) {
  const [draft, setDraft] = useState(template),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const org = config.institutions.find((i) => i.id === template.institution_id),
    clinic = config.clinics.find(
      (c) => c.institution_id === template.institution_id && c.active,
    ),
    doctor = config.doctors.find(
      (d) => d.institution_id === template.institution_id,
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      unwrap(
        await db().rpc("save_excuse_template", {
          institution_id: template.institution_id,
          excuse_type: template.excuse_type,
          expected_version: template.version,
          data: draft,
        }),
      );
      saved();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  async function previewPdf() {
    setBusy(true);
    setError("");
    try {
      const { schoolExcusePdf, savePdf } =
        await import("../../utils/schoolExcusePdf");
      const now = new Date().toISOString();
      const sample = {
        id: "preview",
        patient_id: "preview",
        kind: "SCHOOL_EXCUSE" as const,
        number: "PREGLED PREDLOŠKA",
        status: "VALID",
        issued_at: now,
        expires_on: now,
        revocation_reason: null,
        can_revoke: false,
        verification_token: "",
        payload: {
          number: "PREGLED PREDLOŠKA",
          kind: "SCHOOL_EXCUSE" as const,
          issued_at: now,
          expires_on: now,
          patient: {
            first_name: "Primjer",
            last_name: "Učenika",
            birth_date: "2012-01-01",
            patient_number: "PRIMJER",
          },
          doctor: doctor?.display_name ?? "Ime i prezime liječnika",
          institution: org?.name ?? "Ustanova",
          institution_address: "",
          signature_disclaimer:
            "Interni elektronički potpis e-Zdravstva. Nije kvalificirani elektronički potpis.",
          details: {
            template: draft,
            excuse_type: draft.excuse_type,
            clinic: clinic ?? {
              id: "preview",
              name: "Naziv ambulante",
              code: "ŠIFRA",
              address: "Adresa ambulante",
              city: "Grad",
              phone: "Telefon",
              email: "E-mail",
            },
            doctor_code: doctor?.doctor_code ?? "ŠIFRA",
            signer_fingerprint: doctor?.signer_fingerprint ?? "OSOBNA OZNAKA",
            date_from: "2026-10-01",
            date_to: "2026-10-03",
            category: "Primjer razloga izostanka",
          },
        },
        signature: {
          signed_at: now,
          signature_hash: "",
          signature_method: "PREVIEW",
          certificate_name: "",
          status: "VALID",
          integrity_valid: false,
        },
      };
      savePdf(
        await schoolExcusePdf(sample, "", true),
        "predlozak-" + draft.excuse_type,
      );
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card institution-section spaced">
      <div className="section-heading">
        <h2>
          {template.excuse_type === "PE"
            ? "Tjelesna i zdravstvena kultura"
            : "Redovna nastava"}
        </h2>
        <span className="role-chip">Verzija {template.version}</span>
      </div>
      <div className="template-layout">
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field">
              <span>Naslov dokumenta</span>
              <input
                required
                minLength={2}
                maxLength={100}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </label>
            <label className="field">
              <span>Tekst prije razdoblja OD / DO</span>
              <textarea
                required
                minLength={2}
                maxLength={300}
                value={draft.body_text}
                onChange={(e) =>
                  setDraft({ ...draft, body_text: e.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Dodatni tekst podnožja</span>
              <textarea
                maxLength={300}
                value={draft.footer_text}
                onChange={(e) =>
                  setDraft({ ...draft, footer_text: e.target.value })
                }
              />
            </label>
            <label className="field">
              <span>Tipografija</span>
              <select
                value={draft.font_family}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    font_family: e.target.value as "SERIF" | "SANS",
                  })
                }
              >
                <option value="SERIF">Klasična · Serif</option>
                <option value="SANS">Moderna · Sans</option>
              </select>
            </label>
            <label className="field">
              <span>Veličina teksta</span>
              <select
                value={draft.font_size}
                onChange={(e) =>
                  setDraft({ ...draft, font_size: Number(e.target.value) })
                }
              >
                {[10, 11, 12, 13].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Poravnanje zaglavlja</span>
              <select
                value={draft.header_align}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    header_align: e.target.value as "CENTER" | "LEFT",
                  })
                }
              >
                <option value="CENTER">Sredina</option>
                <option value="LEFT">Lijevo</option>
              </select>
            </label>
            <label className="field">
              <span>Boja</span>
              <select
                value={draft.accent}
                onChange={(e) => setDraft({ ...draft, accent: e.target.value })}
              >
                <option value="#16212b">Tamnografitna</option>
                <option value="#14566b">Plava</option>
                <option value="#087f8a">Tirkizna</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={draft.show_separator}
                onChange={(e) =>
                  setDraft({ ...draft, show_separator: e.target.checked })
                }
              />{" "}
              Razdjelna crta
            </label>
          </div>
          <p className="signature-note">
            Nova verzija primjenjuje se na buduće dokumente. Već izdani
            dokumenti zadržavaju svoj sadržaj i izgled.
          </p>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          <button className="primary" disabled={busy}>
            {busy ? "Spremanje…" : "Spremi novu verziju"}
          </button>
          <button
            type="button"
            className="secondary spaced"
            disabled={busy}
            onClick={() => void previewPdf()}
          >
            Preuzmi pregled PDF-a
          </button>
        </form>
        <div
          className="template-paper"
          style={{
            fontFamily:
              draft.font_family === "SERIF" ? "Georgia, serif" : "sans-serif",
            fontSize: draft.font_size,
            color: draft.accent,
          }}
        >
          <div className="preview-label">
            PREGLED IZGLEDA · IZMIŠLJENI UČENIK
          </div>
          <header
            style={{
              textAlign: draft.header_align === "CENTER" ? "center" : "left",
            }}
          >
            <strong>{org?.name}</strong>
            <div>{clinic?.name || "Naziv ambulante"}</div>
            <div>
              {clinic?.address} {clinic?.city}
            </div>
            <div>Šifra ambulante: {clinic?.code || "—"}</div>
            <div>
              {doctor?.display_name} ·{" "}
              {doctor?.doctor_code || "šifra liječnika"}
            </div>
            <div>
              {clinic?.phone} · {clinic?.email}
            </div>
          </header>
          {draft.show_separator && <hr />}
          <h3>{draft.title}</h3>
          <p>
            Učenik <strong>Primjer Učenika (01.01.2012.)</strong>
          </p>
          <p>
            {draft.body_text} OD <strong>01.10.2026.</strong> DO{" "}
            <strong>03.10.2026.</strong>
          </p>
          <p>Šifra bolesti: prikazuje se samo ako liječnik odabere</p>
          <div className="preview-signature">
            {doctor?.display_name || "Ime i prezime liječnika"}
            <br />
            <small>Pečat i interni elektronički potpis</small>
            <br />
            <code>{doctor?.signer_fingerprint}</code>
          </div>
          <p>{draft.footer_text}</p>
        </div>
      </div>
    </section>
  );
}
