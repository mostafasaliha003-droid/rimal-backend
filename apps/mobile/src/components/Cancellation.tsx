import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { RoomOffer } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { Row, Txt } from './Primitives';
import { cancellationMoneyText, parseCancellationTimestamp, presentCancellation } from './cancellationPresentationModel';
import { cancellationCopy } from './cancellationCopy';
import { useCancellationClock } from './useCancellationClock';
import { cancellationDecision, policyTime } from './cancellationDecision';
import { CancellationSummary } from './RateHighlights';

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
  const [clockZone, setClockZone] = useState<'utc' | 'device'>('utc');
  const deadline = policyTime(model.freeUntil, language, clockZone);
  const ordered = [...model.periods].sort((a,b) => (a.startTime ?? -Infinity) - (b.startTime ?? -Infinity));

  return (
    <View style={{ gap: 10 }}>
      <Txt kind="heading" accessibilityRole="header" style={styles.heading}>{historical ? copy.historical : copy.title}</Txt>
      {historical ? <Txt kind="small">{copy.historicalNote}</Txt> : <View accessibilityLiveRegion="polite" style={{ gap: 5 }}>
        <CancellationSummary decision={cancellationDecision(model, language, offer.price)}/>
        {model.kind === 'unknown' && model.reason && <Txt kind="small">{copy.reasons[model.reason]}</Txt>}
      </View>}
      {deadline && (historical || model.kind === 'unknown' || expanded) && <Txt kind="small">
        {historical ? copy.previousDeadline : copy.deadline} · {deadline}
      </Txt>}
      {model.periods.length > 0 ? (
        <View style={{ gap: 10 }}>
          <Pressable testID="cancellation-schedule-toggle" accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
            onPress={() => setExpanded(value => !value)}
            style={styles.disclosure}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label" style={{ color: colors.blueStrong, flex: 1 }}>{copy.allCharges(model.periods.length)}</Txt>
              <Txt accessible={false} style={{ color: colors.blueStrong }}>{expanded ? '−' : '+'}</Txt>
            </Row>
          </Pressable>
          {expanded && <Row style={styles.zoneGroup}>
            {(['utc', 'device'] as const).map(zone => <Pressable key={zone} testID={'cancellation-zone-' + zone}
              accessibilityRole="button" accessibilityState={{ selected: clockZone === zone }} onPress={() => setClockZone(zone)}
              style={[styles.zone, clockZone === zone && styles.selectedZone]}><Txt kind="label" style={[styles.zoneText, clockZone === zone && { color: colors.surface }]}>
              {zone === 'utc' ? (language === 'ar' ? 'توقيت المورّد (UTC)' : 'Supplier time (UTC)') : (language === 'ar' ? 'توقيت جهازي' : 'My local time')}
            </Txt></Pressable>)}
          </Row>}
          {expanded && ordered.map(period => {
            const start = policyTime(period.startAt, language, clockZone);
            const end = policyTime(period.endAt, language, clockZone);
            const charge = cancellationMoneyText(period.fee);
            const rawAmount = typeof period.amount === 'string' && period.amount.length <= 128 && /^\d+(?:\.\d+)?$/.test(period.amount) ? period.amount : null;
            const currency = typeof period.currency === 'string' && /^[A-Z]{3}$/.test(period.currency) ? period.currency : null;
            const current = !historical && model.kind !== 'unknown' && period.active === true;
            return (
              <Row key={period.index} style={{ gap: 9, alignItems: 'stretch' }}>
                <View accessible={false} style={styles.track}><View style={[styles.dot, current && {backgroundColor: colors.violetInk}]}/>
                  <View style={styles.line}/></View>
                <View style={[styles.interval, current && { backgroundColor: colors.lavenderMist }]}>
                {current && <Txt kind="small" style={{ color: colors.violetInk, fontFamily: fonts.medium }}>{copy.currentPeriod}</Txt>}
                {charge ? <View testID={'cancellation-charge-' + period.index} style={{ gap: 1 }}>
                  <Txt kind="small">{copy.charge}</Txt>
                  <Txt kind="heading" style={{ fontSize: 18, lineHeight: 25, writingDirection: 'ltr' }}>{charge}</Txt>
                </View> : (
                  <View style={{ gap: 4 }}>
                    {rawAmount !== null ? <Txt style={{ writingDirection: 'ltr' }}>{rawAmount}</Txt> : <Txt>{copy.amountMissing}</Txt>}
                    <Txt kind="small">{currency || copy.currencyMissing}</Txt>
                  </View>
                )}
                {(start || period.startInvalid) && <Txt kind="small">{copy.from} {start || copy.timeInvalid}</Txt>}
                {(end || period.endInvalid) && <Txt kind="small">{copy.before} {end || copy.timeInvalid}</Txt>}
                {!start && !end && !period.startInvalid && !period.endInvalid && <Txt kind="small">{language === 'ar' ? 'دون تاريخ بداية أو نهاية محدّد' : 'No start or end date specified'}</Txt>}
                {!period.valid && <Txt kind="small">{copy.periodIssue}</Txt>}
                </View>
              </Row>
            );
          })}
        </View>
      ) : historical ? <Txt kind="small">{copy.reasons.missing}</Txt> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 18, lineHeight: 26 },
  disclosure: { minHeight: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: colors.background, justifyContent: 'center' },
  zoneGroup: { flexWrap: 'wrap', gap: 6 },
  zone: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 22, borderWidth: 1, borderColor: colors.border },
  selectedZone: { backgroundColor: colors.violetInk, borderColor: colors.violetInk },
  zoneText: { fontSize: 13, textAlign: 'center' },
  track: { width: 11, alignItems: 'center', paddingTop: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: colors.violetInk, backgroundColor: colors.surface },
  line: { width: 1, flex: 1, backgroundColor: colors.border },
  interval: { flex: 1, minWidth: 0, gap: 4, paddingVertical: 8, paddingHorizontal: 11, backgroundColor: colors.background, borderRadius: 12 },
});
