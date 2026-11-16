export interface PolicySegment { text: string; direction: 'ltr' | 'auto' }
export interface PolicyRow { label: string; value: string; fields: (string | number)[][]; emphasis?: boolean; segments?: PolicySegment[]; separator?: string }
export interface PolicySection { key: string; title: string; entries: { rows: PolicyRow[] }[]; rows: PolicyRow[] }
export function hotelPolicyCopy(language: string): { title: string; extra: string };
export function hotelPolicySections(hotel: { metapolicy_struct: Record<string, unknown>; metapolicy_extra_info?: string }, language?: string): PolicySection[];
export function hotelExtraInformation(hotel: { metapolicy_extra_info?: string }): string;
export function policyPlainText(value: unknown): string;
