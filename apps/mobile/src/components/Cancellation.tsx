import React from 'react';
import { View } from 'react-native';
import type { RoomOffer } from '../types';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { MoneyText, Txt } from './Primitives';

export function utcTimestamp(value: string | null | undefined, language = 'en'): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return null;
  const date = new Date(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`);
  if (!Number.isFinite(date.getTime())) return null;
  return `${new Intl.DateTimeFormat(language, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date)} UTC+0`;
}
export default function Cancellation({ offer }: { offer: RoomOffer }) {
  const { language, t } = useLanguage(); const free = utcTimestamp(offer.cancellation.freeUntil, language);
  return <View style={{ gap: 10 }}><Txt kind="label">{t('cancellation')}</Txt><Txt kind="small" style={{ color: free ? colors.success : colors.muted }}>{free ? `${t('freeUntil')} ${free}` : t('noFreeCancellation')}</Txt>{offer.cancellation.policies.map((policy, index) => {
    const start = utcTimestamp(policy.startAt, language), end = utcTimestamp(policy.endAt, language);
    return <View key={index} style={{ gap: 5, padding: 12, borderRadius: 12, backgroundColor: colors.background }}><Txt kind="small">{start || end ? [start && `${t('from')} ${start}`, end && `${t('until')} ${end}`].filter(Boolean).join(' · ') : t('allTimes')}</Txt>{policy.amount !== null && policy.currency ? <MoneyText money={{ amount: policy.amount, currency: policy.currency }} /> : <Txt kind="small">{t('amountUnknown')}</Txt>}</View>;
  })}<Txt kind="small">{t('cancellationTime')}</Txt></View>;
}
