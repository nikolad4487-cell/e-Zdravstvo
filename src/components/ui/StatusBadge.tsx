import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
const statuses = {
  ACTIVE: ["Aktivno", "green"],
  ISSUED: ["Izdano", "blue"],
  DISPENSED: ["Realizirano", "green"],
  CANCELLED: ["Otkazano", "red"],
  EXPIRED: ["Isteklo", "gray"],
  PENDING: ["Čeka obradu", "amber"],
  COMPLETED: ["Završeno", "green"],
  SIGNED: ["Digitalno potpisano", "green"],
  DEMO: ["Testni račun", "amber"],
} as const;
export function StatusBadge({ status }: { status: keyof typeof statuses }) {
  const [label, color] = statuses[status];
  const Icon =
    status === "SIGNED"
      ? ShieldCheck
      : status === "PENDING"
        ? Clock3
        : CheckCircle2;
  return (
    <span className={`badge badge-${color}`}>
      <Icon size={13} />
      {label}
    </span>
  );
}
