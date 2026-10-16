import { useEffect, useId, useState } from "react";
import { useResource } from "../../hooks/useResource";
import {
  searchMedicalCodes,
  type MedicalCode,
} from "../../services/medicalCodes";
import { ErrorMessage } from "../ui/Feedback";
export function MedicalCodePicker({
  list,
  name,
  label,
  multiple = false,
  required = false,
  initial = [],
  onSelected,
}: {
  list: string;
  name: string;
  label: string;
  multiple?: boolean;
  required?: boolean;
  initial?: MedicalCode[];
  onSelected?: (items: MedicalCode[]) => void;
}) {
  const id = useId();
  const [search, setSearch] = useState(""),
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
    () => searchMedicalCodes(list, term, page),
    JSON.stringify([list, term, page]),
  );
  const options = [
    ...selected,
    ...(resource.data ?? []).filter(
      (c) => !selected.some((s) => s.code === c.code),
    ),
  ];
  return (
    <div className="field field-full">
      <label htmlFor={id}>
        {label}
        {required ? " *" : ""}
      </label>
      <input
        type="search"
        aria-label={"Traži: " + label}
        placeholder="Traži šifru ili naziv…"
        maxLength={200}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select
        id={id}
        name={name}
        multiple={multiple}
        required={required}
        value={
          multiple ? selected.map((s) => s.code) : (selected[0]?.code ?? "")
        }
        onChange={(e) => {
          const ids = [...e.target.selectedOptions].map((o) => o.value);
          const items = options.filter((o) => ids.includes(o.code));
          setSelected(items);
          onSelected?.(items);
        }}
      >
        {!multiple && <option value="">Odaberite šifru</option>}
        {options.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
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
          disabled={!page || resource.loading}
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
      {selected.map((c) => (
        <small key={c.code}>{c.description}</small>
      ))}
      {multiple && <small>Za više odabira držite Ctrl / Cmd.</small>}
    </div>
  );
}
