import { zagrebTime } from "./calendar";
export function laboratorySlotAllowed(
  details:
    | {
        required_time?: string | null;
        sampling_from?: string;
        sampling_until?: string;
      }
    | null
    | undefined,
  startsAt: string,
  durationMinutes: number,
) {
  if (!details) return true;
  const clock = zagrebTime(startsAt);
  const minutes = (s: string) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  return (
    (!details.required_time || clock === details.required_time.slice(0, 5)) &&
    minutes(clock) >= minutes(details.sampling_from ?? "07:00") &&
    minutes(clock) + durationMinutes <=
      minutes(details.sampling_until ?? "19:00")
  );
}
