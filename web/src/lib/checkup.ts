export const CHECKUP_DAY_MS = 86_400_000;

/** True once `checkupIntervalDays` has elapsed since `lastCheckupAt`; always false when checkups are disabled. */
export function isCheckupDue(person: {
  checkupIntervalDays: number | null;
  lastCheckupAt: string;
}): boolean {
  return (
    person.checkupIntervalDays != null &&
    Date.now() - Date.parse(person.lastCheckupAt) >= person.checkupIntervalDays * CHECKUP_DAY_MS
  );
}
