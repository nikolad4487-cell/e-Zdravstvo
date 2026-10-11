export function Pagination({
  page,
  size,
  loading,
  onChange,
}: {
  page: number;
  size: number;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <nav className="document-actions spaced" aria-label="Stranice rezultata">
      <button
        className="secondary"
        disabled={loading || page === 0}
        onClick={() => onChange(page - 1)}
      >
        Prethodna
      </button>
      <span aria-live="polite">Stranica {page + 1}</span>
      <button
        className="secondary"
        disabled={loading || size < 50 || page >= 10000}
        onClick={() => onChange(page + 1)}
      >
        Sljedeća
      </button>
    </nav>
  );
}
