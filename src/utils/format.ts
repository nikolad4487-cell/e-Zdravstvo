export function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("hr-HR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value.length === 10 ? value + "T12:00:00" : value));
}
export function age(birth: string) {
  const today = new Date(),
    dob = new Date(birth);
  let n = today.getFullYear() - dob.getFullYear();
  if (
    today.getMonth() < dob.getMonth() ||
    (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())
  )
    n--;
  return n;
}
export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function readableError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Radnja nije uspjela. Pokušajte ponovno.";
}
