import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors, fonts, tokens } from '../theme';
import { Button, Row, Txt } from './Primitives';
import { beginCalendarRange, calendarRangeBounds, calendarRangeMonth, monthDays, pickCalendarDate,
  shiftMonth, todayDate, type CalendarField, type StayDates } from './calendarModel';

interface CalendarProps {
  initialField: CalendarField;
  checkin: string;
  checkout: string;
  onSelect: (dates: StayDates) => void;
  onClose: () => void;
}

const phaseTitles = {
  en: { checkin: 'Choose check-in date', checkout: 'Choose check-out date' },
  ar: { checkin: 'اختر تاريخ الوصول', checkout: 'اختر تاريخ المغادرة' },
};
const fields = ['checkin', 'checkout'] as const;
const utcDay = (value: string) => new Date(value + 'T00:00:00Z');

export default function CalendarPicker({ initialField, checkin, checkout, onSelect, onClose }: CalendarProps) {
  const { language, rtl, t } = useLanguage();
  const [today, setToday] = useState(() => todayDate());
  const [draft, setDraft] = useState(() => beginCalendarRange(initialField, checkin, checkout, today));
  const [month, setMonth] = useState(() => calendarRangeMonth(draft, today));
  const { min, max } = calendarRangeBounds(draft, today);
  const title = phaseTitles[language][draft.field];
  const focusDay = useRef<React.ComponentRef<typeof Pressable>>(null);
  const shouldFocusDay = useRef(false);
  const format = useMemo(() => {
    const options = { timeZone: 'UTC', calendar: 'gregory' };
    const weekdays = new Intl.DateTimeFormat(language, { ...options, weekday: rtl ? 'narrow' : 'short' });
    return {
      weekdays: Array.from({ length: 7 }, (_, i) => weekdays.format(new Date(Date.UTC(2023, 0, 1 + i)))),
      month: new Intl.DateTimeFormat(language, { ...options, month: 'long', year: 'numeric' }),
      day: new Intl.DateTimeFormat(language, { ...options, dateStyle: 'full' }),
      compact: new Intl.DateTimeFormat(language, { ...options, year: 'numeric', month: 'short', day: 'numeric' }),
      number: new Intl.NumberFormat(rtl ? 'ar-u-nu-arab' : 'en'),
    };
  }, [language, rtl]);
  const days = monthDays(month);
  const weekCount = Math.ceil(days.length / 7);
  const focusDate = draft[draft.field] || min;

  useEffect(() => {
    if (shouldFocusDay.current && Platform.OS === 'web') focusDay.current?.focus();
    shouldFocusDay.current = false;
  }, [draft.field, month]);

  const chooseDay = (date: string) => {
    const currentDay = todayDate();
    setToday(currentDay);
    const next = pickCalendarDate(draft, date, currentDay);
    if (next.selection) {
      onSelect(next.selection);
    } else if (next.draft !== draft) {
      shouldFocusDay.current = true;
      setDraft(next.draft);
      setMonth(calendarRangeMonth(next.draft, currentDay));
    }
  };
  const editField = (field: CalendarField) => {
    if (field === draft.field) return;
    const currentDay = todayDate();
    setToday(currentDay);
    const next = beginCalendarRange(field, draft.checkin, draft.checkout, currentDay);
    shouldFocusDay.current = true;
    setDraft(next);
    setMonth(calendarRangeMonth(next, currentDay));
  };
  const gridFlow = rtl ? styles.weekRTL : styles.weekLTR;

  return (
    <Modal visible transparent animationType="slide" accessibilityLabel={title} onRequestClose={onClose}>
      <SafeAreaView edges={['top']} style={styles.backdrop}>
        <SafeAreaView edges={['bottom']} style={styles.sheet} accessibilityViewIsModal>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Row style={styles.header}>
              <Txt testID="stay-calendar-title" kind="heading" accessibilityRole="header"
                accessibilityLiveRegion="polite" aria-live="polite" style={styles.title}>{title}</Txt>
              <View testID="calendar-close"><Button compact variant="quiet" title={t('close')} onPress={onClose}/></View>
            </Row>

            <Row style={styles.fields}>
              {fields.map(field => {
                const active = draft.field === field;
                const disabled = field === 'checkout' && !draft.checkin;
                const value = draft[field] ? format.compact.format(utcDay(draft[field])) : t('selectDate');
                return (
                  <Pressable key={field} testID={'calendar-edit-' + field} disabled={disabled}
                    accessibilityRole="button" accessibilityLabel={t(field) + ', ' + value}
                    accessibilityState={{ disabled, ...(Platform.OS === 'web' ? {} : { selected: active }) }}
                    aria-pressed={active} onPress={() => editField(field)}
                    style={[styles.field, active && styles.activeField]}>
                    <Txt kind="small" style={active && styles.accent}>{t(field)}</Txt>
                    <Txt kind="label">{value}</Txt>
                  </Pressable>
                );
              })}
            </Row>

            <Row style={styles.monthRow}>
              <Button compact variant="secondary" title={rtl ? '→' : '←'} label={t('previousMonth')}
                disabled={month <= min.slice(0, 7)} onPress={() => setMonth(shiftMonth(month, -1))}/>
              <Txt kind="label" style={styles.month} accessibilityLiveRegion="polite" aria-live="polite">
                {format.month.format(utcDay(month + '-01'))}
              </Txt>
              <Button compact variant="secondary" title={rtl ? '←' : '→'} label={t('nextMonth')}
                disabled={month >= max.slice(0, 7)} onPress={() => setMonth(shiftMonth(month, 1))}/>
            </Row>

            <View>
              <View style={gridFlow}>
                {format.weekdays.map((name, i) => <View key={i} style={styles.weekday}>
                  <Txt kind="small" style={styles.weekdayName}>{name}</Txt>
                </View>)}
              </View>
              {Array.from({ length: weekCount }, (_, week) => (
                <View key={week} style={gridFlow}>
                  {Array.from({ length: 7 }, (_, weekday) => {
                    const date = days[week * 7 + weekday];
                    if (!date) return <View key={weekday} style={styles.cell}/>;
                    const disabled = date < min || date > max;
                    const endpoint = date === draft.checkin || date === draft.checkout;
                    const inStay = draft.checkin && draft.checkout && date > draft.checkin && date < draft.checkout;
                    return <View key={weekday} style={styles.cell}>
                      <Pressable ref={date === focusDate ? focusDay : undefined} testID={'calendar-day-' + date}
                        disabled={disabled} accessibilityRole="button" accessibilityLabel={format.day.format(utcDay(date))}
                        accessibilityState={{ disabled, ...(Platform.OS === 'web' ? {} : { selected: endpoint }) }}
                        aria-pressed={endpoint} onPress={() => chooseDay(date)}
                        style={({ pressed }) => [styles.day, !!inStay && styles.inStay,
                          endpoint && styles.endpoint, pressed && styles.pressed]}>
                        <Txt style={[styles.digit, disabled && styles.disabledDigit, endpoint && styles.endpointDigit]}>
                          {format.number.format(Number(date.slice(-2)))}
                        </Txt>
                      </Pressable>
                    </View>;
                  })}
                </View>
              ))}
            </View>
          </ScrollView>
        </SafeAreaView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#102A4380' },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '100%', alignSelf: 'center', direction: 'ltr',
    borderTopLeftRadius: tokens.space.xxl, borderTopRightRadius: tokens.space.xxl, backgroundColor: colors.surface, overflow: 'hidden' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: tokens.space.md, paddingVertical: tokens.space.lg, gap: tokens.space.md },
  header: { justifyContent: 'space-between', paddingHorizontal: tokens.space.xs },
  title: { flex: 1 },
  fields: { alignItems: 'stretch', gap: tokens.space.sm },
  field: { flex: 1, minHeight: tokens.control.minHeight, padding: tokens.space.md, borderRadius: tokens.radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, gap: 2 },
  activeField: { backgroundColor: colors.softBlue, borderColor: colors.blueStrong },
  accent: { color: colors.blueStrong },
  monthRow: { justifyContent: 'space-between', paddingHorizontal: tokens.space.xs },
  month: { flex: 1, textAlign: 'center', fontSize: 17 },
  weekLTR: { flexDirection: 'row', direction: 'ltr' },
  weekRTL: { flexDirection: 'row-reverse', direction: 'ltr' },
  weekday: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: tokens.space.xs },
  weekdayName: { textAlign: 'center', fontFamily: fonts.bold },
  cell: { flex: 1, minWidth: 0, padding: 1 },
  day: { minHeight: tokens.control.minHeight, borderRadius: tokens.radius.sm,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  inStay: { backgroundColor: colors.softBlue },
  endpoint: { backgroundColor: colors.navy },
  pressed: { opacity: 0.75 },
  digit: { textAlign: 'center', color: colors.navy, fontFamily: fonts.bold },
  disabledDigit: { color: colors.muted, fontFamily: fonts.regular },
  endpointDigit: { color: colors.surface, fontFamily: fonts.bold },
});
