import type { Money, Tax } from '../types';
import { canonicalDecimal } from './offerReviewModel';

export type TaxInclusion = 'included' | 'excluded' | 'unknown';
export type TaxSubtotalIssue = 'amount' | 'inclusion' | 'currency';
export interface TaxRowView {
  index: number;
  name: string;
  amount: string | null;
  currency: string | null;
  inclusion: TaxInclusion;
  amountValid: boolean;
  currencyValid: boolean;
  money: Readonly<Money> | null;
}
export interface TaxExcludedGroup {
  currency: string;
  rows: readonly Readonly<TaxRowView>[];
  complete: boolean;
  subtotal: Readonly<Money> | null;
  incompleteReasons: readonly TaxSubtotalIssue[];
}
export interface TaxPresentation {
  rows: readonly Readonly<TaxRowView>[];
  dataState: 'supplied' | 'notSupplied';
  hasExcluded: boolean;
  hasUnknown: boolean;
  excludedGroups: readonly Readonly<TaxExcludedGroup>[];
  unassignedExcluded: readonly Readonly<TaxRowView>[];
}

const validAmount = (value: unknown): value is string => typeof value === 'string' && value.length <= 128 && /^\d+(?:\.\d+)?$/.test(value);
const validCurrency = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
/** Exact decimal addition; only single digits enter numeric arithmetic. */
function addAmounts(left: string, right: string): string {
  const [aw, af = ''] = canonicalDecimal(left).split('.'), [bw, bf = ''] = canonicalDecimal(right).split('.');
  const scale = Math.max(af.length, bf.length);
  const width = Math.max(aw.length, bw.length) + scale;
  const a = (aw + af.padEnd(scale, '0')).padStart(width, '0');
  const b = (bw + bf.padEnd(scale, '0')).padStart(width, '0');
  const digits: string[] = [];
  let carry = 0;
  for (let index = width - 1; index >= 0; index -= 1) {
    const digit = a.charCodeAt(index) - 48 + b.charCodeAt(index) - 48 + carry;
    carry = digit >= 10 ? 1 : 0;
    digits.push(String(digit % 10));
  }
  if (carry) digits.push('1');
  const result = digits.reverse().join('');
  return canonicalDecimal(scale ? `${result.slice(0, -scale)}.${result.slice(-scale)}` : result);
}

function rowView(tax: Tax, index: number): Readonly<TaxRowView> {
  const name = typeof tax?.name === 'string' ? tax.name : '';
  const amount = typeof tax?.amount === 'string' ? tax.amount : null;
  const currency = typeof tax?.currency_code === 'string' ? tax.currency_code : null;
  const inclusion = tax?.included_by_supplier === true ? 'included'
    : tax?.included_by_supplier === false ? 'excluded' : 'unknown';
  const amountValid = validAmount(amount), currencyValid = validCurrency(currency);
  const money = amountValid && currencyValid ? Object.freeze({ amount, currency }) : null;
  return Object.freeze({ index, name, amount, currency, inclusion, amountValid, currencyValid, money });
}

/**
 * Supplier tax_data line items are already amounts in each row's currency.
 * Sum only supplied, explicitly excluded entries; never deduplicate, multiply
 * by nights/guests, convert currency or add them to a displayed/quoted price.
 * Completeness describes this supplied subtotal, not an exhaustive tax bill.
 */
export function presentTaxes(taxes: readonly Tax[] | null | undefined): TaxPresentation {
  const rows = Object.freeze(Array.isArray(taxes) ? Array.from(taxes, rowView) : []);
  const excluded = rows.filter(row => row.inclusion === 'excluded');
  const unassignedExcluded = Object.freeze(excluded.filter(row => !row.currencyValid));
  const potentialUnknownCurrency = rows.some(row => row.inclusion !== 'included' && !row.currencyValid);
  const grouped = new Map<string, Readonly<TaxRowView>[]>();
  for (const row of excluded) {
    if (!row.currencyValid || row.currency === null) continue;
    const group = grouped.get(row.currency) || [];
    group.push(row);
    grouped.set(row.currency, group);
  }
  const excludedGroups = Object.freeze([...grouped].map(([currency, groupRows]) => {
    const incompleteReasons: TaxSubtotalIssue[] = [];
    if (groupRows.some(row => !row.amountValid)) incompleteReasons.push('amount');
    if (rows.some(row => row.inclusion === 'unknown' && (!row.currencyValid || row.currency === currency))) incompleteReasons.push('inclusion');
    // An excluded/potentially-excluded amount with no known currency could
    // belong to any group, so no otherwise-known group is advertised complete.
    if (potentialUnknownCurrency) incompleteReasons.push('currency');
    const complete = incompleteReasons.length === 0;
    const subtotal = complete ? Object.freeze({ currency,
      amount: groupRows.reduce((sum, row) => addAmounts(sum, row.amount!), '0') }) : null;
    return Object.freeze({ currency, rows: Object.freeze(groupRows), complete, subtotal,
      incompleteReasons: Object.freeze(incompleteReasons) });
  }));
  return Object.freeze({ rows, dataState: rows.length ? 'supplied' : 'notSupplied',
    hasExcluded: excluded.length > 0,
    hasUnknown: rows.some(row => !row.amountValid || !row.currencyValid || row.inclusion === 'unknown'),
    excludedGroups, unassignedExcluded });
}
