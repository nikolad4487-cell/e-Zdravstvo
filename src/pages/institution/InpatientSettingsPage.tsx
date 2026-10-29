import { useState } from "react";
import { useResource } from "../../hooks/useResource";
import { inpatientContext, inpatientCommand } from "../../services/inpatient";
import { Field, values } from "../../components/ui/Fields";
import { ErrorMessage } from "../../components/ui/Feedback";
import { readableError } from "../../utils/format";
export function InpatientSettingsPage() {
  const resource = useResource(inpatientContext, "ward-settings");
  const [wardEdit, setWardEdit] = useState<string | null>(null),
    [bedEdit, setBedEdit] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function save(
    e: React.FormEvent<HTMLFormElement>,
    kind: "WARD" | "BED",
  ) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = values(form);
    setBusy(true);
    setError("");
    try {
      if (kind === "WARD")
        await inpatientCommand("save_inpatient_ward", {
          ward_id: wardEdit,
          institution_id: data.institution_id,
          name: data.name,
          active: data.active === "true",
        });
      else
        await inpatientCommand("save_inpatient_bed", {
          bed_id: bedEdit,
          ward_id: data.ward_id,
          label: data.label,
          active: data.active === "true",
        });
      form.reset();
      setWardEdit(null);
      setBedEdit(null);
      setSuccess("Bolnički smještaj je spremljen.");
      resource.refresh();
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  const orgs = resource.data?.institutions.filter((i) => i.can_manage) ?? [],
    wards =
      resource.data?.wards.filter((w) =>
        orgs.some((i) => i.id === w.institution_id),
      ) ?? [],
    beds =
      resource.data?.beds.filter((b) =>
        orgs.some((i) => i.id === b.institution_id),
      ) ?? [],
    ward = wards.find((w) => w.id === wardEdit),
    bed = beds.find((b) => b.id === bedEdit);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Bolnički smještaj</h1>
          <p>
            Upravljanje odjelima i krevetima. Zauzetost se izvodi iz aktivnih
            prijama.
          </p>
        </div>
        <button type="button" className="secondary" onClick={resource.refresh}>
          Osvježi smještaj
        </button>
      </div>
      {(error || resource.error) && (
        <ErrorMessage>{error || resource.error}</ErrorMessage>
      )}
      {success && (
        <p role="status" className="feedback success">
          {success}
        </p>
      )}
      {resource.loading ? (
        <p role="status">Učitavanje smještaja…</p>
      ) : !orgs.length ? (
        <p>
          Za uređivanje smještaja potrebna je administratorska uloga ustanove.
        </p>
      ) : (
        <>
          <div className="account-grid">
            <form
              key={"ward-" + wardEdit}
              className="card section-stack"
              onSubmit={(e) => save(e, "WARD")}
            >
              <h2>{ward ? "Uredi odjel" : "Novi bolnički odjel"}</h2>
              <Field
                name="institution_id"
                label="Ustanova odjela"
                required
                defaultValue={ward?.institution_id ?? ""}
              >
                {ward ? (
                  <option value={ward.institution_id}>
                    {orgs.find((i) => i.id === ward.institution_id)?.name}
                  </option>
                ) : (
                  <>
                    <option value="">Odaberite ustanovu</option>
                    {orgs.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </>
                )}
              </Field>
              <Field
                name="name"
                label="Naziv bolničkog odjela"
                required
                minLength={2}
                maxLength={150}
                defaultValue={ward?.name ?? ""}
              />
              <Field
                name="active"
                label="Dostupnost odjela"
                defaultValue={ward?.active === false ? "false" : "true"}
              >
                <option value="true">Aktivan</option>
                <option value="false">Neaktivan</option>
              </Field>
              <div className="document-actions">
                <button className="primary" disabled={busy}>
                  Spremi odjel
                </button>
                {ward && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setWardEdit(null)}
                  >
                    Novi odjel
                  </button>
                )}
              </div>
            </form>
            <form
              key={"bed-" + bedEdit}
              className="card section-stack"
              onSubmit={(e) => save(e, "BED")}
            >
              <h2>{bed ? "Uredi krevet" : "Novi krevet"}</h2>
              <Field
                name="ward_id"
                label="Odjel kreveta"
                required
                defaultValue={bed?.ward_id ?? ""}
              >
                {bed ? (
                  <option value={bed.ward_id}>{bed.ward_name}</option>
                ) : (
                  <>
                    <option value="">Odaberite odjel</option>
                    {wards.map((w) => (
                      <option key={w.id} value={w.id}>
                        {orgs.find((i) => i.id === w.institution_id)?.name} ·{" "}
                        {w.name}
                      </option>
                    ))}
                  </>
                )}
              </Field>
              <Field
                name="label"
                label="Oznaka sobe i kreveta"
                required
                maxLength={100}
                defaultValue={bed?.label ?? ""}
                placeholder="Npr. soba 101 · krevet 1"
              />
              <Field
                name="active"
                label="Dostupnost kreveta"
                defaultValue={bed?.active === false ? "false" : "true"}
              >
                <option value="true">Aktivan</option>
                <option value="false">Neaktivan</option>
              </Field>
              <div className="document-actions">
                <button className="primary" disabled={busy || !wards.length}>
                  Spremi krevet
                </button>
                {bed && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setBedEdit(null)}
                  >
                    Novi krevet
                  </button>
                )}
              </div>
            </form>
          </div>
          <h2 className="spaced">Odjeli i zauzetost</h2>
          <div className="section-stack">
            {wards.map((w) => (
              <section className="card" key={w.id}>
                <div className="section-heading">
                  <h3>
                    {w.name} ·{" "}
                    {orgs.find((i) => i.id === w.institution_id)?.name}
                  </h3>
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => setWardEdit(w.id)}
                  >
                    Uredi odjel
                  </button>
                </div>
                <p>{w.active ? "Aktivan odjel" : "Neaktivan odjel"}</p>
                {beds
                  .filter((b) => b.ward_id === w.id)
                  .map((b) => (
                    <div className="section-heading clinical-note" key={b.id}>
                      <span>
                        {b.label} ·{" "}
                        {!b.active
                          ? "Neaktivan"
                          : b.occupied
                            ? "Zauzet"
                            : "Slobodan"}
                      </span>
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => setBedEdit(b.id)}
                      >
                        Uredi krevet
                      </button>
                    </div>
                  ))}
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
