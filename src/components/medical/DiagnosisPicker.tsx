import { useEffect, useId, useState } from "react";
import { useResource } from "../../hooks/useResource";
import {
  searchDiagnosisCodes,
  type DiagnosisCode,
} from "../../services/medicalCodes";
import { ErrorMessage } from "../ui/Feedback";
export function DiagnosisPicker({
  name,
  label,
  required = false,
  multiple = false,
  initial = [],
  onSelected,
}: {
  name: string;
  label: string;
  required?: boolean;
  multiple?: boolean;
  initial?: DiagnosisCode[];
  onSelected?: (items: DiagnosisCode[]) => void;
}) {
  const id = useId(),
    [search, setSearch] = useState(""),
    [term, setTerm] = useState(""),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState(initial);
  useEffect(() => {
    const timer = setTimeout(() => {
      setTerm(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  const resource = useResource(
    () => searchDiagnosisCodes(term, page),
    term + ":" + page,
  );
  const options = [
    ...selected,
    ...(resource.data ?? []).filter(
      (d) => !selected.some((s) => s.id === d.id),
    ),
  ];
  return (
    <div className="field diagnosis-picker">
      <label htmlFor={id}>
        {label}
        {required && " *"}
      </label>
      <input
        aria-label={"Traži: " + label}
        type="search"
        placeholder="Traži šifru ili naziv bolesti…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        maxLength={200}
      />
      <select
        id={id}
        name={name}
        multiple={multiple}
        required={required}
        value={multiple ? selected.map((s) => s.id) : (selected[0]?.id ?? "")}
        onChange={(e) => {
          const ids = [...e.target.selectedOptions].map((o) => o.value);
          const items = options.filter((o) => ids.includes(o.id));
          setSelected(items);
          onSelected?.(items);
        }}
      >
        {!multiple && (
          <option value="">
            {required ? "Odaberite dijagnozu" : "Bez odabrane dijagnoze"}
          </option>
        )}
        {options.map((d) => (
          <option key={d.id} value={d.id}>
            {d.code} · {d.name}
          </option>
        ))}
      </select>
      {resource.loading && (
        <small role="status">Pretraživanje šifrarnika…</small>
      )}
      {resource.error && <ErrorMessage>{resource.error}</ErrorMessage>}
      <div className="catalog-page-controls">
        <button
          type="button"
          className="secondary"
          disabled={page === 0 || resource.loading}
          onClick={() => setPage(page - 1)}
        >
          Prethodne šifre
        </button>
        <button
          type="button"
          className="secondary"
          disabled={(resource.data?.length ?? 0) < 50 || resource.loading}
          onClick={() => setPage(page + 1)}
        >
          Sljedeće šifre
        </button>
      </div>
      {multiple && <small>Za više odabira držite Ctrl / Cmd.</small>}
    </div>
  );
}
