export function zagrebDate(value = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zagreb",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}
export function zagrebTime(value: string) {
  return new Intl.DateTimeFormat("hr-HR", {
    timeZone: "Europe/Zagreb",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
export function shiftDate(value: string, days: number) {
  const d = new Date(value + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function calendarRange(date: string, view: "day" | "week" | "month") {
  if (view === "day") return [date];
  const first = view === "month" ? date.slice(0, 8) + "01" : date;
  const day = new Date(first + "T12:00:00Z").getUTCDay();
  const monday = shiftDate(first, -((day + 6) % 7));
  return Array.from({ length: view === "month" ? 42 : 7 }, (_, i) =>
    shiftDate(monday, i),
  );
}
