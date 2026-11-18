import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api, COUNTRY_CODES, validateSearchCriteria } from '../api';
import type { GuestRoom, SearchCriteria, Suggestion } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import ApiState from '../components/ApiState';
import { Button, Field, Icon, Row, Txt } from '../components/Primitives';
import CalendarPicker from '../components/CalendarPicker';
import GuestPicker from '../components/GuestPicker';
import CountryPicker, { countryName } from '../components/CountryPicker';
import { addDays, todayDate, validDate } from '../components/calendarModel';
import { copyGuestRooms, destinationFromSearch, quickStayDates, recentSearchDraft, shouldSuggestDestination, stayNights, type QuickStay } from '../components/searchJourneyModel';
import { searchCopy } from './searchCopy';

export default function SearchScreen() {
  const { t, language, rtl } = useLanguage(); const router = useRouter(); const state = useAppState(); const copy = searchCopy(language);
  const [query, setQuery] = useState(state.destinationName); const [selected, select] = useState<Suggestion | null>(() => destinationFromSearch(state.criteria, state.destinationName));
  const [suggestionResult, setSuggestionResult] = useState<{ key: string; values: Suggestion[]; error: unknown }>({ key: '', values: [], error: null });
  const [suggestionRetry, retrySuggestion] = useState(0);
  const suggestionKey = `${language}:${query}:${suggestionRetry}`;
  const suggestions = suggestionResult.key === suggestionKey ? suggestionResult.values : [];
  const needsSuggestions = shouldSuggestDestination(query, selected);
  const suggesting = needsSuggestions && suggestionResult.key !== suggestionKey;
  const suggestError = suggestionResult.key === suggestionKey && suggestionResult.error;
  const [checkin, setCheckin] = useState(state.criteria?.checkin || ''); const [checkout, setCheckout] = useState(state.criteria?.checkout || '');
  const [guests, setGuests] = useState<GuestRoom[]>(() => copyGuestRooms(state.criteria?.guests || [{ adults: 2, children: [] }]));
  const [residency, setResidency] = useState(state.criteria?.residency || 'ae'); const [currency, setCurrency] = useState(state.criteria?.currency || 'USD');
  const [calendar, setCalendar] = useState<'checkin'|'checkout'|null>(null); const [guestOpen, showGuests] = useState(false); const [countryOpen, showCountry] = useState(false); const [errors, setErrors] = useState<Record<string, boolean>>({}); const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (!needsSuggestions) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { api.searchSuggestions(query.trim(), language, controller.signal).then(values => { if (!controller.signal.aborted) setSuggestionResult({ key: suggestionKey, values, error: null }); }).catch(error => { if (!controller.signal.aborted) setSuggestionResult({ key: suggestionKey, values: [], error }); }); }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, language, suggestionKey, needsSuggestions]);
  const submit = () => {
    const destination = selected?.name === query ? selected : query === state.destinationName ? destinationFromSearch(state.criteria, query) : null;
    const criteria: SearchCriteria = { checkin, checkout, guests: copyGuestRooms(guests), residency, currency, language, ...(destination?.regionId ? { regionId: destination.regionId } : destination?.hid ? { hids: [destination.hid] } : {}) };
    const validation = validateSearchCriteria(criteria); const next = { destination: !destination || !query.trim(), dates: !validDate(checkin) || !validDate(checkout) || checkin < todayDate() || checkout <= checkin || checkout > addDays(checkin, 30), residency: !COUNTRY_CODES.includes(residency), guests: guests.some(room => room.children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) };
    setErrors(next); setSubmitted(true);
    if (!validation.valid || Object.values(next).some(Boolean)) return;
    Keyboard.dismiss(); state.setSearch(criteria, query.trim()); router.push('/results');
  };
  const restoreRecent = (id: string) => {
    // Re-resolve ownership at press time: an old session's rendered handler
    // must not restore a record after logout or same-account reauthentication.
    const recent = state.getRecentSearches().find(value => value.id === id);
    if (!recent) return;
    const draft = recentSearchDraft(recent); if (!draft) return;
    setQuery(draft.query); select(draft.selected); setCheckin(draft.checkin); setCheckout(draft.checkout);
    setGuests(draft.guests); setResidency(draft.residency); setCurrency(draft.currency);
    setErrors({}); setSubmitted(false); setSuggestionResult({ key: '', values: [], error: null }); Keyboard.dismiss();
  };
  const chooseQuickStay = (kind: QuickStay) => {
    const dates = quickStayDates(kind); setCheckin(dates.checkin); setCheckout(dates.checkout);
    setErrors(current => ({ ...current, dates: false }));
  };
  const nights = stayNights(checkin, checkout);
  const adults = guests.reduce((sum, room) => sum + room.adults, 0); const childCount = guests.reduce((sum, room) => sum + room.children.length, 0);
  const guestSummary = copy.guests(adults, childCount, guests.length);
  return <SafeAreaView edges={['top']} style={ui.screen}><BrandHeader /><EnvironmentBanner /><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'} contentContainerStyle={{ paddingBottom: 28 }}>
    <View style={{ backgroundColor: colors.navy, paddingHorizontal: 24, paddingVertical: 12, gap: 4 }}><Txt kind="small" style={{ color: '#8ED5DF', fontFamily: fonts.bold, fontSize: 10, lineHeight: 16 }}>{t('heroKicker')}</Txt><Txt accessibilityRole="header" style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 23, lineHeight: 29 }}>{t('heroTitle')}</Txt></View>
    <View style={[ui.page, { paddingTop: 14 }]}><View style={[ui.card, ui.shadow, { padding: 16, gap: 12 }]}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt kind="heading" accessibilityRole="header">{t('search')}</Txt>{nights !== null && <Txt kind="small" style={{ color: colors.blueStrong, fontFamily: fonts.bold }} accessibilityLiveRegion="polite">{copy.nights(nights)}</Txt>}</Row>
      <View style={{ gap: 8 }}><Field label={t('destination')} value={query} onChangeText={value => { setQuery(value); select(null); setSubmitted(false); }} placeholder={t('destinationHint')} autoCorrect={false} returnKeyType="search" error={errors.destination ? t('pickDestination') : undefined} />
        {suggesting && <Txt kind="small" accessibilityLiveRegion="polite">{t('loading')}</Txt>}
        {!suggesting && needsSuggestions && (suggestError ? <ApiState error={suggestError} retry={() => retrySuggestion(value => value + 1)} /> : suggestions.length === 0 ? <Txt kind="small">{t('noSuggestions')}</Txt> : <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>{suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}${item.subtitle ? `, ${item.subtitle}` : ''}`} onPress={() => { select(item); setQuery(item.name); setErrors(current => ({ ...current, destination: false })); Keyboard.dismiss(); }} style={{ minHeight: 60, padding: 13, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}><Row><Icon name="search" color={colors.blueStrong} size={18} /><View style={{ flex: 1 }}><Txt style={{ fontFamily: fonts.bold }}>{item.name}</Txt>{item.subtitle && <Txt kind="small">{item.subtitle}</Txt>}</View></Row></Pressable>)}</View>)}
      </View>
      <Row style={{ alignItems: 'stretch' }}>{(['checkin', 'checkout'] as const).map(key => <Pressable key={key} accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setCalendar(key); }} style={{ flex: 1, minHeight: 72, padding: 12, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: errors.dates ? colors.red : colors.border, gap: 5 }}><Txt kind="small">{t(key)}</Txt><Txt style={{ fontFamily: fonts.bold, fontSize: 15, writingDirection: 'ltr', textAlign: rtl ? 'right' : 'left' }}>{(key === 'checkin' ? checkin : checkout) || t('selectDate')}</Txt></Pressable>)}</Row>
      {errors.dates && <Txt accessibilityRole="alert" kind="small" style={{ color: colors.red }}>{t('datesError')}</Txt>}
      <Row style={{ alignItems: 'stretch' }}><Pressable accessibilityRole="button" accessibilityHint={guestSummary} onPress={() => showGuests(true)} style={{ flex: 1, padding: 12, minHeight: 76, borderRadius: 14, backgroundColor: colors.background, gap: 4 }}><Txt kind="small">{t('guests')}</Txt><Txt kind="label">{guestSummary}</Txt></Pressable>
      <Pressable accessibilityRole="button" accessibilityHint={countryName(residency, language)} onPress={() => showCountry(true)} style={{ flex: 1, padding: 12, minHeight: 76, borderRadius: 14, backgroundColor: colors.background, gap: 4 }}><Txt kind="small">{t('residency')}</Txt><Txt kind="label">{countryName(residency, language)}</Txt><Txt kind="small" style={{ fontSize: 11, lineHeight: 15 }}>{residency.toUpperCase()}</Txt></Pressable></Row>
      <View style={{ gap: 6 }} accessibilityRole="radiogroup" accessibilityLabel={t('currency')}><Txt kind="label">{t('currency')}</Txt><Row style={{ gap: 8 }}>{['USD','AED','SAR','EUR'].map(code => <Pressable key={code} accessibilityRole="radio" accessibilityLabel={code} aria-checked={code === currency} accessibilityState={{ checked: code === currency }} onPress={() => setCurrency(code)} style={{ flex: 1, minHeight: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: currency === code ? colors.blueStrong : colors.border, backgroundColor: currency === code ? colors.softBlue : '#fff' }}><Txt kind="label" style={{ color: currency === code ? colors.blueStrong : colors.muted }}>{code}</Txt></Pressable>)}</Row></View>
      {submitted && (errors.residency || errors.guests) && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t(errors.residency ? 'residencyError' : 'guestsError')}</Txt>}
      <Button title={t('search')} onPress={submit} />
    </View>
    <View style={{ gap: 10 }}><Txt kind="label">{copy.quickDates}</Txt><View style={{ gap: 8 }}>{(['tonight','tomorrow','nextWeek'] as const).map(kind => { const dates = quickStayDates(kind); const chosen = dates.checkin === checkin && dates.checkout === checkout; return <Pressable key={kind} accessibilityRole="button" accessibilityLabel={copy[kind]} aria-pressed={chosen} accessibilityState={{ selected: chosen }} onPress={() => chooseQuickStay(kind)} style={{ minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: chosen ? colors.blueStrong : colors.border, backgroundColor: chosen ? colors.softBlue : colors.surface }}><Txt kind="label" style={{ color: chosen ? colors.blueStrong : colors.navy }}>{copy[kind]}</Txt></Pressable>; })}</View><Txt kind="small">{copy.quickDatesBody}</Txt></View>
    {state.recentSearches.length > 0 && <View style={[ui.card, { padding: 16 }]}><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt kind="heading" accessibilityRole="header">{copy.recent}</Txt><Pressable accessibilityRole="button" accessibilityLabel={`${t('clear')} · ${copy.clearRecent}`} onPress={state.clearRecentSearches} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{t('clear')}</Txt></Pressable></Row><Txt kind="small">{copy.recentBody}</Txt>{state.recentSearches.map(recent => <Pressable key={recent.id} accessibilityRole="button" accessibilityHint={copy.recentHint} onPress={() => restoreRecent(recent.id)} style={{ minHeight: 72, padding: 14, gap: 6, backgroundColor: colors.background, borderRadius: 14 }}><Txt kind="label">{recent.name}</Txt><Txt kind="small" style={{ writingDirection: 'ltr' }}>{recent.criteria.checkin} → {recent.criteria.checkout}</Txt></Pressable>)}</View>}
    <View style={{ paddingHorizontal: 5, gap: 7 }}><Txt>{t('heroText')}</Txt><Txt kind="small">{t('searchNotes')}</Txt><Txt kind="label">{t('sandboxBody')}</Txt><Txt kind="small">{t('foundationNote')}</Txt></View></View>
  </ScrollView>{calendar !== null && <CalendarPicker visible title={t(calendar || 'checkin')} value={calendar === 'checkout' ? checkout : checkin} min={calendar === 'checkout' && validDate(checkin) ? addDays(checkin, 1) : todayDate()} max={calendar === 'checkout' && validDate(checkin) ? addDays(checkin, 30) : addDays(todayDate(), 730)} onClose={() => setCalendar(null)} onSelect={value => { if (calendar === 'checkin') { setCheckin(value); if (!validDate(checkout) || checkout <= value || checkout > addDays(value, 30)) setCheckout(addDays(value, 1)); } else setCheckout(value); setErrors(current => ({ ...current, dates: false })); }} />}{guestOpen && <GuestPicker visible value={guests} onClose={() => showGuests(false)} onChange={setGuests} />}<CountryPicker visible={countryOpen} value={residency} onClose={() => showCountry(false)} onChange={setResidency} /></SafeAreaView>;
}
