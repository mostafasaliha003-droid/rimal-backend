export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function todayDate(now = new Date()): string { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function addDays(value: string, count: number): string { if (!validDate(value)) return ''; const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); }
export function monthDays(month: string): (string | null)[] { if (!validDate(`${month}-01`)) return []; const first = new Date(`${month}-01T00:00:00Z`); const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate(); return [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)]; }
export function shiftMonth(month: string, count: number): string { if (!validDate(`${month}-01`)) return ''; const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + count); return date.toISOString().slice(0, 7); }

export type CalendarField = 'checkin' | 'checkout';
export interface StayDates { checkin: string; checkout: string }
export interface CalendarRangeDraft extends StayDates { field: CalendarField }
interface DateBounds { min: string; max: string }

function arrivalBounds(today: string): DateBounds {
  return { min: today, max: addDays(today, 730) };
}

function departureBounds(checkin: string): DateBounds {
  return { min: addDays(checkin, 1), max: addDays(checkin, 30) };
}

function within(date: string, bounds: DateBounds): boolean {
  return validDate(date) && date >= bounds.min && date <= bounds.max;
}

export function beginCalendarRange(field: CalendarField, checkin: string, checkout: string, today: string): CalendarRangeDraft {
  if (!within(checkin, arrivalBounds(today))) return { field: 'checkin', checkin: '', checkout: '' };
  return { field, checkin, checkout: within(checkout, departureBounds(checkin)) ? checkout : '' };
}

export function calendarRangeBounds(draft: CalendarRangeDraft, today: string): DateBounds {
  return draft.field === 'checkout' ? departureBounds(draft.checkin) : arrivalBounds(today);
}

export function calendarRangeMonth(draft: CalendarRangeDraft, today: string): string {
  const bounds = calendarRangeBounds(draft, today);
  const selected = draft[draft.field];
  return (within(selected, bounds) ? selected : bounds.min).slice(0, 7);
}

export function pickCalendarDate(draft: CalendarRangeDraft, date: string, today: string): {
  draft: CalendarRangeDraft; selection: StayDates | null;
} {
  if (draft.field === 'checkout' && !within(draft.checkin, arrivalBounds(today))) {
    // A sheet can remain open past local midnight. Ask for a current arrival.
    return { draft: beginCalendarRange('checkin', '', '', today), selection: null };
  }
  if (!within(date, calendarRangeBounds(draft, today))) return { draft, selection: null };
  if (draft.field === 'checkin') return { draft: { field: 'checkout', checkin: date, checkout: '' }, selection: null };
  const selection = { checkin: draft.checkin, checkout: date };
  return { draft: { field: 'checkout', ...selection }, selection };
}
