import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { RoomOffer } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { Row, Txt } from './Primitives';
import { cancellationMoneyText, parseCancellationTimestamp, presentCancellation } from './cancellationPresentationModel';
import { cancellationCopy } from './cancellationCopy';
import { useCancellationClock } from './useCancellationClock';

// Kept as a named export for account-deletion receipts as well as policy times.
export function utcTimestamp(value: string | null | undefined, language = 'en'): string | null {
  const timestamp = parseCancellationTimestamp(value);
  if (timestamp === null) return null;
  const date = new Date(timestamp);
  try {
    return `${new Intl.DateTimeFormat(language, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      ...(date.getUTCMilliseconds() ? { fractionalSecondDigits: 3 as const } : {}),
      hourCycle: 'h23', calendar: 'gregory', timeZone: 'UTC',
    }).format(date)} UTC+0`;
  } catch {
    return `${date.toISOString().replace('T', ' ').replace(/Z$/, '')} UTC+0`;
  }
}

export default function Cancellation({ offer, now, mode = 'current', defaultExpanded = false }: {
  offer: RoomOffer; now?: number; mode?: 'current' | 'historical'; defaultExpanded?: boolean;
}) {
  const { language } = useLanguage();
  const copy = cancellationCopy(language);
  const historical = mode === 'historical';
  const clock = useCancellationClock(historical || now !== undefined ? [] : [offer.cancellation]);
  const model = presentCancellation(offer.cancellation, now ?? clock);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const fee = cancellationMoneyText(model.fee);
  const deadline = utcTimestamp(model.freeUntil, language);
  const deadlineElapsed = model.deadlineState === 'elapsed' && Number.isFinite(now ?? clock);
  const summaryColor = model.kind === 'free' ? colors.success : model.kind === 'fee' ? colors.navy : colors.muted;

  return (
    <View style={{ gap: 10 }}>
      <Txt kind="label">{historical ? copy.historical : copy.title}</Txt>
      {historical ? <Txt kind="small">{copy.historicalNote}</Txt> : (
        <View style={{ gap: 5 }} accessibilityLiveRegion="polite">
          <Txt kind="label" style={{ color: summaryColor }}>{copy[model.kind]}</Txt>
          {fee && <Txt style={{ fontFamily: fonts.bold, color: summaryColor, writingDirection: 'ltr' }}>{fee}</Txt>}
          {model.kind === 'unknown' && model.reason && <Txt kind="small">{copy.reasons[model.reason]}</Txt>}
        </View>
      )}
      {deadline ? (
        <View style={{ gap: 4 }}>
          <Txt kind="small">{historical ? copy.previousDeadline : deadlineElapsed ? copy.deadlinePassed : copy.deadline}</Txt>
          <Txt kind="small" style={{ writingDirection: 'ltr' }}>{deadline}</Txt>
        </View>
      ) : <Txt kind="small">{model.deadlineState === 'invalid' ? copy.deadlineInvalid : copy.deadlineMissing}</Txt>}
      <Txt kind="small">{copy.timezone}</Txt>
      {model.periods.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
            onPress={() => setExpanded(value => !value)}
            style={{ minHeight: 48, paddingVertical: 11, justifyContent: 'center' }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label" style={{ color: colors.blueStrong, flex: 1 }}>{copy.allCharges(model.periods.length)}</Txt>
              <Txt accessible={false} style={{ color: colors.blueStrong }}>{expanded ? '−' : '+'}</Txt>
            </Row>
          </Pressable>
          {expanded && model.periods.map(period => {
            const start = utcTimestamp(period.startAt, language);
            const end = utcTimestamp(period.endAt, language);
            const charge = cancellationMoneyText(period.fee);
            const rawAmount = typeof period.amount === 'string' && period.amount.length <= 128 && /^\d+(?:\.\d+)?$/.test(period.amount) ? period.amount : null;
            const currency = typeof period.currency === 'string' && /^[A-Z]{3}$/.test(period.currency) ? period.currency : null;
            const current = !historical && period.active === true;
            return (
              <View key={period.index} style={{ gap: 7, padding: 13, borderRadius: 13, borderWidth: 1,
                borderColor: current ? colors.blueStrong : colors.border, backgroundColor: colors.background }}>
                <Txt kind="label">{copy.period(period.index + 1)}</Txt>
                {current && <Txt kind="small" style={{ color: colors.blueStrong }}>{copy.currentPeriod}</Txt>}
                <Txt kind="small">{copy.from}</Txt>
                <Txt kind="small" style={start ? { writingDirection: 'ltr' } : undefined}>
                  {period.startInvalid ? copy.timeInvalid : start || copy.startOpen}
                </Txt>
                <Txt kind="small">{copy.before}</Txt>
                <Txt kind="small" style={end ? { writingDirection: 'ltr' } : undefined}>
                  {period.endInvalid ? copy.timeInvalid : end || copy.endOpen}
                </Txt>
                <Txt kind="small">{copy.charge}</Txt>
                {charge ? <Txt style={{ fontFamily: fonts.bold, writingDirection: 'ltr' }}>{charge}</Txt> : (
                  <View style={{ gap: 4 }}>
                    {rawAmount !== null ? <Txt style={{ writingDirection: 'ltr' }}>{rawAmount}</Txt> : <Txt>{copy.amountMissing}</Txt>}
                    <Txt kind="small">{currency || copy.currencyMissing}</Txt>
                  </View>
                )}
                {!period.valid && <Txt kind="small">{copy.periodIssue}</Txt>}
              </View>
            );
          })}
        </View>
      ) : historical ? <Txt kind="small">{copy.reasons.missing}</Txt> : null}
    </View>
  );
}
