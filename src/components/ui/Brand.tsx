import { Cross } from "lucide-react";
export function Brand({ light = false }: { light?: boolean }) {
  return (
    <div className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-mark">
        <Cross size={23} strokeWidth={2.6} />
      </span>
      <span>
        e-Zdravstvo<span className="brand-dot">.</span>
      </span>
    </div>
  );
}
