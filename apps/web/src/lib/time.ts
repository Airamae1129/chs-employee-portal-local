export const IE_TIME_ZONE = "Europe/Dublin";
export const PH_TIME_ZONE = "Asia/Manila";

/** Formats `date` (defaults to now) in the given IANA zone as "HH:mm:ss". */
export function formatClock(zone: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/** Formats `date` (defaults to now) in the given IANA zone as "Mon, 8 Sep". */
export function formatDateShort(zone: string, date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}
