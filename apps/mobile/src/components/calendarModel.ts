export function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function todayDate(now = new Date()): string { return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; }
export function addDays(value: string, count: number): string { if (!validDate(value)) return ''; const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); }
export function monthDays(month: string): (string | null)[] { if (!validDate(`${month}-01`)) return []; const first = new Date(`${month}-01T00:00:00Z`); const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate(); return [...Array(first.getUTCDay()).fill(null), ...Array.from({ length: days }, (_, index) => `${month}-${String(index + 1).padStart(2, '0')}`)]; }
export function shiftMonth(month: string, count: number): string { if (!validDate(`${month}-01`)) return ''; const date = new Date(`${month}-01T00:00:00Z`); date.setUTCMonth(date.getUTCMonth() + count); return date.toISOString().slice(0, 7); }
