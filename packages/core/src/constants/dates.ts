/**
 * A day a person picks, read as the UK reads it. A listing that "expires on
 * 10 Oct" stays on sale to the end of 10 Oct in the UK, not to midnight UTC
 * at its start (R5: a listing dated today was expired on creation).
 */
export const BUSINESS_TIME_ZONE = 'Europe/London';

/** Minutes a time zone is ahead of UTC at an instant (London: 0 or 60). */
function offsetMinutes(at: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-GB', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(at)
    .find((part) => part.type === 'timeZoneName')?.value;
  const match = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(name ?? '');
  if (!match) return 0; // "GMT" alone: no offset
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === '-' ? -minutes : minutes;
}

/**
 * The last millisecond of a calendar day ("YYYY-MM-DD") in the UK.
 * Throws on anything that is not a real date.
 */
export function endOfDayInLondon(day: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) throw new Error(`Not a date: ${day}`);
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Midnight starting the next day, as if London were UTC; then shift by the
  // offset London has at that moment.
  const nextMidnight = Date.UTC(year, month - 1, date + 1);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    throw new Error(`Not a date: ${day}`);
  }
  const offset = offsetMinutes(new Date(nextMidnight), BUSINESS_TIME_ZONE);
  return new Date(nextMidnight - offset * 60_000 - 1);
}
