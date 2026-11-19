import type { HotelAmenity } from '../types';

type Fee = HotelAmenity['fee'];
type Group = { name: string; items: HotelAmenity[] };
type RecordValue = Record<string, unknown>;
const records = (value: unknown): RecordValue[] => Array.isArray(value)
  ? value.filter(row => row !== null && typeof row === 'object' && !Array.isArray(row)) : [];
const names = (value: unknown): string[] => Array.isArray(value)
  ? value.filter((name): name is string => typeof name === 'string').map(name => name.trim()).filter(Boolean) : [];

function nameKey(name: string) {
  const normalized = name.normalize('NFKC').toLowerCase().replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/wi[\s\u2010-\u2014-]*fi\b/g, 'wifi').replace(/\s+/g, ' ').trim();
  if (/^(?:wireless internet(?: access)?|(?:ال)?واي[\s-]*فاي|(?:ال)?[إا]نترنت لاسلكي)$/.test(normalized)) return 'wifi';
  if (/^(?:wired internet(?: access)?|(?:ال)?[إا]نترنت سلكي)$/.test(normalized)) return 'wired internet';
  return normalized;
}

const freeServiceNames = new Set(['wifi', 'internet', 'internet access', 'parking', 'pool', 'spa', 'sauna',
  'massage', 'gym', 'breakfast', 'shuttle', 'transfer', 'transfers', 'toiletries', 'bottled water']);
function isServiceName(name: string) {
  const normalized = nameKey(name);
  const base = normalized.replace(/\s+(?:in|at|throughout|to|from)\s+[\p{L}\s-]+$/u, '')
    .replace(/^(?:(?:high[ -]speed|wireless|wired|valet|self|private|public|airport|indoor|outdoor|swimming)[ -])+/, '');
  return freeServiceNames.has(base);
}

function namedAmenity(rawName: string): HotelAmenity {
  // Preserve conditions, alternatives and compound services verbatim.
  if (/\b(?:not|except|excluding|only|first|limited|subject to|up to|may|if|with purchase|and|or|but)\b|[&/;؛،]|(?:فقط|لأول|باستثناء|غير مجاني|بشرط|مقابل|حسب)/i.test(rawName)) {
    return { name: rawName, fee: 'unknown' };
  }
  // Distinguish monetary "free" from vocabulary such as "free weights" or "free parking is unavailable".
  const advertised = /^(?:free|complimentary)\s+(.+)$/i.exec(rawName);
  const free = advertised && isServiceName(advertised[1]) ? advertised :
    /^(.+?)\s*(?:\((?:free|free of charge|complimentary|at no extra charge)\)|\s+(?:free of charge|at no extra charge|مجاني(?:ة)?|مجانا[ً]?|مجانًا|بدون رسوم|دون رسوم))$/i.exec(rawName);
  const paid = /^(?:paid)\s+(.+)$/i.exec(rawName)
    || /^(.+?)\s*(?:\((?:extra charge|additional charge|surcharge|paid|برسوم(?: إضافية)?)\)|\s+(?:for (?:a fee|an additional fee)|برسوم(?: إضافية)?))$/i.exec(rawName);
  if (free && !paid && !/^paid\s/i.test(rawName)) return { name: free[1].trim(), fee: 'free' };
  if (paid && !free && !/^(?:free|complimentary)\s/i.test(rawName)) return { name: paid[1].trim(), fee: 'paid' };
  return { name: rawName, fee: 'unknown' };
}

function policyFee(policy: RecordValue): Fee {
  const amount = policy.price;
  const supplied = amount !== undefined && amount !== null && amount !== '';
  if (supplied && (typeof amount !== 'string' && typeof amount !== 'number' || !/^\d+(?:\.\d+)?$/.test(String(amount)))) return 'unknown';
  if (policy.inclusion === 'included' && (!supplied || Number(amount) === 0)) return 'free';
  if (policy.inclusion === 'not_included' && (!supplied || Number(amount) > 0)) return 'paid';
  return 'unknown';
}

function internetEvidence(name: string, policies: RecordValue[], listedFees: Set<Fee>): Fee | undefined {
  // Room-only or public-area service cannot establish an unqualified property-wide price.
  const key = nameKey(name);
  if (key !== 'wifi' && key !== 'wired internet') return undefined;
  const type = key === 'wifi' ? 'wireless' : 'wired';
  // ETG documents "hotel" and also supplies "whole_hotel" in its hotel content example.
  const whole = policies.find(policy => policy.internet_type === type
    && (policy.work_area === 'hotel' || policy.work_area === 'whole_hotel'));
  const relevant = policies.filter(policy => policy.internet_type === type || policy.internet_type === 'unspecified' || !policy.internet_type);
  const fees = new Set(relevant.map(policyFee));
  if (fees.size > 1) return 'unknown';
  if (whole) return policyFee(whole);
  // A narrower policy may contradict an explicit label. Never use it alone to confirm the price everywhere.
  if ((fees.has('paid') && listedFees.has('free')) || (fees.has('free') && listedFees.has('paid'))) return 'unknown';
  return undefined;
}

function normalizeGroup(group: RecordValue, policies: RecordValue[]): Group {
  const byName = new Map<string, {name: string; fees: Set<Fee>}>();
  function add(rawName: string, listedAsPaid: boolean) {
    const named = namedAmenity(rawName);
    const key = nameKey(named.name);
    if (!byName.has(key)) byName.set(key, { name: named.name, fees: new Set() });
    const row = byName.get(key)!;
    if (named.fee !== 'unknown') row.fees.add(named.fee);
    if (listedAsPaid) row.fees.add('paid');
  }
  names(group.amenities).forEach(name => add(name, false));
  names(group.non_free_amenities).forEach(name => add(name, true));
  const items: HotelAmenity[] = [];
  for (const {name, fees} of byName.values()) {
    const internet = internetEvidence(name, policies, fees);
    if (internet) fees.add(internet);
    items.push({ name, fee: fees.size === 1 ? [...fees][0] : 'unknown' });
  }
  return { name: typeof group.group_name === 'string' ? group.group_name.trim() : '', items };
}

export function normalizeHotelAmenities(groups: unknown, internetPolicies?: unknown, flatNames?: unknown): Group[] {
  const policies = records(internetPolicies);
  const result = records(groups).map(group => normalizeGroup(group, policies)).filter(group => group.items.length);
  if (result.length) return result;
  const legacy = records(flatNames).map(row => ({
    name: typeof row.name === 'string' ? row.name : row.title,
    paid: row.paid === true
  }));
  const fallback = normalizeGroup({
    amenities: [...names(flatNames), ...legacy.map(row => row.name)],
    non_free_amenities: legacy.filter(row => row.paid).map(row => row.name)
  }, policies);
  return fallback.items.length ? [fallback] : [];
}
