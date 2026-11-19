import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import type { GuestRoom, SearchCriteria } from '../types';
import { useLanguage } from '../i18n';
import { color, radius, space, touch } from '../theme';
import { Badge, Icon, Row, Txt } from './Primitives';
import { formatDay, formatWeekday, guestLine, nightsBetween, stayWords } from './format';
import { useAppState } from './AppState';
import CalendarPicker from './CalendarPicker';
import GuestPicker from './GuestPicker';
import { useLayout } from './motion';

const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

/** Check-in and check-out side by side; the night count sits on the check-out field. */
export function DateFields({ checkin, checkout, error = false, onOpen }: {
  checkin: string; checkout: string; error?: boolean; onOpen: (field: 'checkin' | 'checkout') => void;
}) {
  const { t, language } = useLanguage();
  const { narrow, fontScale } = useLayout();
  const nights = nightsBetween(checkin, checkout);
  const words = stayWords(language);
  return <Row style={{ gap: space.sm, alignItems: 'stretch', ...(narrow || fontScale > 1.4 ? { flexDirection: 'column' } : {}) }}>
    {(['checkin', 'checkout'] as const).map(field => {
      const value = field === 'checkin' ? checkin : checkout;
      return <Pressable key={field} testID={`search-date-${field}`} accessibilityRole="button"
        onPress={() => onOpen(field)} style={state => [styles.field, { flex: 1 }, error && !value && styles.fieldError, (state.pressed || hovered(state)) && styles.fieldActive]}>
        <Row style={{ gap: space.xs, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Row style={{ gap: space.xs, flexShrink: 1 }}><Icon name="calendar" size={16} color={color.textSecondary}/><Txt kind="caption">{t(field)}</Txt></Row>
          {field === 'checkout' && nights !== null && <Badge tone="info" icon="moon" label={words.nights(nights)}/>}
        </Row>
        <Txt kind="subheading" numberOfLines={1} style={{ color: value ? color.textPrimary : color.textSecondary }}>
          {value ? formatDay(value, language) : t('selectDate')}</Txt>
        {!!value && <Txt kind="caption" numberOfLines={1}>{formatWeekday(value, language)}</Txt>}
      </Pressable>;
    })}
  </Row>;
}

export function GuestsField({ guests, onOpen, error = false }: { guests: readonly GuestRoom[]; onOpen: () => void; error?: boolean }) {
  const { t, language } = useLanguage();
  const ages = guests.flatMap(room => room.children);
  return <Pressable testID="search-guests" accessibilityRole="button"
    onPress={onOpen} style={state => [styles.field, error && styles.fieldError, (state.pressed || hovered(state)) && styles.fieldActive]}>
    <Row style={{ gap: space.md }}>
      <Icon name="users" size={20} color={color.textSecondary}/>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt kind="caption">{t('guests')}</Txt>
        <Txt kind="subheading" numberOfLines={2}>{guestLine(guests, language)}</Txt>
        {ages.length > 0 && <Txt kind="caption">{language === 'ar' ? `أعمار الأطفال: ${ages.join('، ')}` : `Children’s ages: ${ages.join(', ')}`}</Txt>}
      </View>
      <Icon name="chevron" size={18} color={color.textSecondary}/>
    </Row>
  </Pressable>;
}

/**
 * The stay every price on the screen is quoted for. Each part is a button that edits
 * it in place, so changing dates or guests never costs the traveler their place.
 */
export function StaySummaryBar({ criteria, onEditDates, onEditGuests, testID = 'stay-summary', stacked: forceStacked }: {
  criteria: SearchCriteria; onEditDates?: () => void; onEditGuests?: () => void; testID?: string; stacked?: boolean;
}) {
  const { language } = useLanguage();
  const { wide } = useLayout();
  const stacked = forceStacked ?? !wide;
  const ar = language === 'ar';
  const nights = nightsBetween(criteria.checkin, criteria.checkout);
  const words = stayWords(language);
  const dates = `${formatDay(criteria.checkin, language, { weekday: true })} – ${formatDay(criteria.checkout, language, { weekday: true })}`;
  const part = (key: 'dates' | 'guests', icon: 'calendar' | 'users', text: string, caption: string, onPress?: () => void) =>
    <Pressable key={key} testID={`${testID}-${key}`} accessibilityRole="button" disabled={!onPress}
      accessibilityHint={onPress ? (ar ? 'اضغط للتعديل دون مغادرة الصفحة' : 'Change without leaving this page') : undefined}
      onPress={onPress} style={state => [styles.summaryPart, (state.pressed || hovered(state)) && onPress ? styles.fieldActive : null]}>
      <Row style={{ gap: space.sm }}>
        <Icon name={icon} size={18} color={color.interactiveStrong}/>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt kind="label" numberOfLines={2}>{text}</Txt>
          <Txt kind="caption" numberOfLines={1}>{caption}</Txt>
        </View>
        {onPress && <Icon name="edit" size={16} color={color.interactiveStrong}/>}
      </Row>
    </Pressable>;
  const body = <>
    {part('dates', 'calendar', dates, nights ? words.nights(nights) : (ar ? 'التواريخ' : 'Dates'), onEditDates)}
    <View style={stacked ? styles.summaryRule : styles.summaryDivider}/>
    {part('guests', 'users', guestLine(criteria.guests, language), ar ? 'الضيوف والغرف' : 'Guests & rooms', onEditGuests)}
  </>;
  return stacked ? <View testID={testID} style={styles.summary}>{body}</View> : <Row testID={testID} style={styles.summary}>{body}</Row>;
}

/** Opens the calendar or guest editor over the current screen and applies the change as a new search. */
export function useStayEditor({ savedOnly = false }: { savedOnly?: boolean } = {}) {
  const state = useAppState();
  const [editor, setEditor] = useState<{ kind: 'dates'; field: 'checkin' | 'checkout' } | { kind: 'guests' } | null>(null);
  const criteria = state.criteria;
  const apply = (changes: Partial<SearchCriteria>) => {
    if (!criteria) return;
    const next = { ...criteria, ...changes };
    if (savedOnly) state.setSavedSearch(next); else state.setSearch(next, state.destinationName);
  };
  const element = !criteria || !editor ? null : editor.kind === 'dates'
    ? <CalendarPicker initialField={editor.field} checkin={criteria.checkin} checkout={criteria.checkout} onClose={() => setEditor(null)}
      onSelect={dates => { setEditor(null); if (dates.checkin !== criteria.checkin || dates.checkout !== criteria.checkout) apply(dates); }}/>
    : <GuestPicker visible value={criteria.guests} onClose={() => setEditor(null)} onChange={rooms => apply({ guests: rooms })}/>;
  return { editDates: (field: 'checkin' | 'checkout' = 'checkin') => setEditor({ kind: 'dates', field }), editGuests: () => setEditor({ kind: 'guests' }), element };
}

const styles = StyleSheet.create({
  field: { minHeight: 64, justifyContent: 'center', gap: space.xxs, paddingHorizontal: space.md, paddingVertical: space.sm,
    borderRadius: radius.md, borderWidth: 1, borderColor: color.borderControl, backgroundColor: color.bgSurface },
  fieldActive: { backgroundColor: color.bgMuted, borderColor: color.interactive },
  fieldError: { borderColor: color.danger, borderWidth: 1.5 },
  summary: { alignItems: 'stretch', backgroundColor: color.bgSurface, borderRadius: radius.lg, borderWidth: 1, borderColor: color.border, overflow: 'hidden' },
  summaryPart: { flexGrow: 1, flexBasis: 0, minHeight: touch.comfortable, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm },
  summaryDivider: { width: 1, backgroundColor: color.border, marginVertical: space.sm },
  summaryRule: { height: 1, backgroundColor: color.border, marginHorizontal: space.md },
});
