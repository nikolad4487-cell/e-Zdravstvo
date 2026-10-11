import { useEffect, useId, useState } from "react";
import { useResource } from "../../hooks/useResource";
import {
  searchPrescriptionMedications,
  type PrescriptionMedication,
} from "../../services/medicalCodes";
import { ErrorMessage } from "../ui/Feedback";
import { dateLabel } from "../../utils/format";
export function MedicationPicker({
  name,
  onSelected,
}: {
  name: string;
  onSelected: (medication: PrescriptionMedication | undefined) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<PrescriptionMedication>();
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const resource = useResource(
    () => searchPrescriptionMedications(term, page),
    term + ":" + page,
  );
  const options = [
    ...(selected ? [selected] : []),
    ...(resource.data ?? []).filter((m) => m.id !== selected?.id),
  ];
  const fields = selected?.catalog_metadata.fields;
  return (
    <div className="field field-full">
      <label htmlFor={id}>Lijek i pakiranje *</label>
      <input
        type="search"
        aria-label="Traži lijek"
        placeholder="Naziv lijeka, djelatna tvar ili ATK šifra…"
        value={search}
        maxLength={200}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        id={id}
        name={name}
        required
        value={selected?.id ?? ""}
        onChange={(e) => {
          const m = options.find((m) => m.id === e.target.value);
          setSelected(m);
          onSelected(m);
        }}
      >
        <option value="">Odaberite lijek i točno pakiranje</option>
        {options.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name} ·{" "}
            {m.packaging || [m.strength, m.form].filter(Boolean).join(" · ")} ·{" "}
            {m.catalog_metadata.family ?? "Lokalni"} · {m.catalog_code}
          </option>
        ))}
      </select>
      {resource.loading && <small role="status">Pretraživanje lijekova…</small>}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      {!resource.loading && resource.data?.length === 0 && (
        <small>Nema lijekova za unesenu pretragu.</small>
      )}
      <div className="catalog-page-controls">
        <button
          type="button"
          className="secondary"
          disabled={page === 0 || resource.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodni lijekovi
        </button>
        <button
          type="button"
          className="secondary"
          disabled={(resource.data?.length ?? 0) < 50 || resource.loading}
          onClick={() => setPage(page + 1)}
        >
          Sljedeći lijekovi
        </button>
      </div>
      {selected && (
        <div className="confirm-box">
          <p>
            {selected.name} · {selected.active_ingredient}
          </p>
          <p>{selected.packaging}</p>
          {selected.catalog_metadata.source_date && (
            <p>
              {selected.catalog_metadata.family} · izdanje od{" "}
              {dateLabel(selected.catalog_metadata.source_date)} ·{" "}
              {selected.catalog_code}
            </p>
          )}
          {fields?.["R/RS"] && (
            <p>
              Propisivanje: {fields["R/RS"]}
              {fields["R/RS"] !== "R" &&
                " — prema preporuci odgovarajućeg specijalista."}
            </p>
          )}
          {fields?.["Oznaka ograničenja primjene"] && (
            <p>Ograničenje primjene: {fields["Oznaka ograničenja primjene"]}</p>
          )}
          {fields?.["Doplata za orig. pakiranje"] !== undefined && (
            <p>
              Doplata prema listi:{" "}
              {Number(fields["Doplata za orig. pakiranje"]).toLocaleString(
                "hr-HR",
                { minimumFractionDigits: 2 },
              )}{" "}
              EUR po pakiranju.
            </p>
          )}
          {selected.catalog_metadata.guidance?.map((g) => (
            <p key={g.code}>
              {g.code} · {g.name}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
