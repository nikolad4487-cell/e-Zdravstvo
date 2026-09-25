import { AlertCircle, LoaderCircle } from "lucide-react";
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" /> Učitavanje sigurnog radnog prostora…
    </div>
  );
}
export function ErrorMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="feedback error" role="alert">
      <AlertCircle size={18} />
      <span>{children}</span>
    </div>
  );
}
export function Disclaimer() {
  return (
    <p className="disclaimer">
      Demonstracijski sustav. Nije povezan s CEZIH-om, HZZO-om, e-Građanima niti
      drugim službenim zdravstvenim sustavima Republike Hrvatske.
    </p>
  );
}
