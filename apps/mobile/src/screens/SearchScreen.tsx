import React, { useEffect, useState } from 'react';
import { Keyboard, Pressable, ScrollView, View } from 'react-native';
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

export default function SearchScreen() {
  const { t, language, rtl } = useLanguage(); const router = useRouter(); const state = useAppState();
  const [query, setQuery] = useState(state.destinationName); const [selected, select] = useState<Suggestion | null>(null);
  const [suggestionResult, setSuggestionResult] = useState<{ key: string; values: Suggestion[]; error: unknown }>({ key: '', values: [], error: null });
  const [suggestionRetry, retrySuggestion] = useState(0);
  const suggestionKey = `${language}:${query}:${suggestionRetry}`;
  const suggestions = suggestionResult.key === suggestionKey ? suggestionResult.values : [];
  const suggesting = query.trim().length >= 2 && selected?.name !== query && suggestionResult.key !== suggestionKey;
  const suggestError = suggestionResult.key === suggestionKey && suggestionResult.error;
  const [checkin, setCheckin] = useState(state.criteria?.checkin || ''); const [checkout, setCheckout] = useState(state.criteria?.checkout || '');
  const [guests, setGuests] = useState<GuestRoom[]>(state.criteria?.guests || [{ adults: 2, children: [] }]);
  const [residency, setResidency] = useState(state.criteria?.residency || 'ae'); const [currency, setCurrency] = useState(state.criteria?.currency || 'USD');
  const [calendar, setCalendar] = useState<'checkin'|'checkout'|null>(null); const [guestOpen, showGuests] = useState(false); const [countryOpen, showCountry] = useState(false); const [errors, setErrors] = useState<Record<string, boolean>>({}); const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (selected?.name === query || query.trim().length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { api.searchSuggestions(query.trim(), language, controller.signal).then(values => { if (!controller.signal.aborted) setSuggestionResult({ key: suggestionKey, values, error: null }); }).catch(error => { if (!controller.signal.aborted) setSuggestionResult({ key: suggestionKey, values: [], error }); }); }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, selected?.name, language, suggestionKey]);
  const submit = () => {
    const destination = selected || (query === state.destinationName && state.criteria ? state.criteria.regionId ? { regionId: state.criteria.regionId } : { hid: state.criteria.hids?.[0] } : null);
    const criteria: SearchCriteria = { checkin, checkout, guests, residency, currency, language, ...(destination && 'regionId' in destination && destination.regionId ? { regionId: destination.regionId } : destination && 'hid' in destination && destination.hid ? { hids: [destination.hid] } : {}) };
    const validation = validateSearchCriteria(criteria); const next = { destination: !destination || !query.trim(), dates: !validDate(checkin) || !validDate(checkout) || checkin < todayDate() || checkout <= checkin || checkout > addDays(checkin, 30), residency: !COUNTRY_CODES.includes(residency), guests: guests.some(room => room.children.some(age => !Number.isInteger(age) || age < 0 || age > 17)) };
    setErrors(next); setSubmitted(true);
    if (!validation.valid || Object.values(next).some(Boolean)) return;
    Keyboard.dismiss(); state.setSearch(criteria, query.trim()); router.push('/results');
  };
  const adults = guests.reduce((sum, room) => sum + room.adults, 0); const childCount = guests.reduce((sum, room) => sum + room.children.length, 0);
  return <SafeAreaView edges={['top']} style={ui.screen}><BrandHeader /><EnvironmentBanner /><ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 28 }}>
    <View style={{ backgroundColor: colors.navy, padding: 26, paddingTop: 30, paddingBottom: 52, overflow: 'hidden' }}><View accessible={false} style={{ position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: '#15556A', opacity: .7, right: -100, bottom: -100 }} /><Txt kind="small" style={{ color: '#8ED5DF', fontFamily: fonts.bold, letterSpacing: 1.2 }}>{t('heroKicker')}</Txt><Txt accessibilityRole="header" style={{ color: '#fff', fontFamily: fonts.bold, fontSize: 34, lineHeight: 46, marginTop: 14 }}>{t('heroTitle')}</Txt><Txt style={{ color: '#D1E1EC', marginTop: 14, maxWidth: 470, alignSelf: rtl ? 'flex-end' : 'flex-start' }}>{t('heroText')}</Txt></View>
    <View style={[ui.page, { marginTop: -26 }]}><View style={[ui.card, ui.shadow, { padding: 20, gap: 20 }]}>
      <View style={{ gap: 5 }}><Txt kind="heading">{t('search')}</Txt><Txt kind="small">{t('searchNotes')}</Txt></View>
      <View style={{ gap: 8 }}><Field label={t('destination')} value={query} onChangeText={value => { setQuery(value); select(null); setSubmitted(false); }} placeholder={t('destinationHint')} autoCorrect={false} returnKeyType="search" error={errors.destination ? t('pickDestination') : undefined} />
        {suggesting && <Txt kind="small" accessibilityLiveRegion="polite">{t('loading')}</Txt>}
        {!suggesting && selected?.name !== query && query.trim().length >= 2 && (suggestError ? <ApiState error={suggestError} retry={() => retrySuggestion(value => value + 1)} /> : suggestions.length === 0 ? <Txt kind="small">{t('noSuggestions')}</Txt> : <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>{suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}${item.subtitle ? `, ${item.subtitle}` : ''}`} onPress={() => { select(item); setQuery(item.name); setErrors(current => ({ ...current, destination: false })); Keyboard.dismiss(); }} style={{ minHeight: 60, padding: 13, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}><Row><Icon name="search" color={colors.blueStrong} size={18} /><View style={{ flex: 1 }}><Txt style={{ fontFamily: fonts.bold }}>{item.name}</Txt>{item.subtitle && <Txt kind="small">{item.subtitle}</Txt>}</View></Row></Pressable>)}</View>)}
      </View>
      <Row style={{ alignItems: 'stretch' }}>{(['checkin', 'checkout'] as const).map(key => <Pressable key={key} accessibilityRole="button" accessibilityLabel={`${t(key)}: ${key === 'checkin' ? checkin || t('selectDate') : checkout || t('selectDate')}`} onPress={() => { Keyboard.dismiss(); setCalendar(key); }} style={{ flex: 1, padding: 14, borderRadius: 14, backgroundColor: colors.background, borderWidth: 1, borderColor: errors.dates ? colors.red : colors.border, gap: 7 }}><Txt kind="small">{t(key)}</Txt><Txt style={{ fontFamily: fonts.bold, fontSize: 16, writingDirection: 'ltr', textAlign: rtl ? 'right' : 'left' }}>{(key === 'checkin' ? checkin : checkout) || t('selectDate')}</Txt></Pressable>)}</Row>
      {errors.dates && <Txt accessibilityRole="alert" kind="small" style={{ color: colors.red }}>{t('datesError')}</Txt>}
      <Pressable accessibilityRole="button" accessibilityLabel={t('guests')} onPress={() => showGuests(true)} style={{ padding: 15, borderRadius: 14, backgroundColor: colors.background, gap: 6 }}><Txt kind="small">{t('guests')}</Txt><Txt style={{ fontFamily: fonts.bold }}>{`${adults} ${t('adults')}${childCount ? ` · ${childCount} ${t('children')}` : ''} · ${guests.length} ${t('rooms')}`}</Txt></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={t('residency')} onPress={() => showCountry(true)} style={{ gap: 6 }}><Txt kind="label">{t('residency')}</Txt><Row style={{ justifyContent: 'space-between', backgroundColor: colors.background, padding: 14, borderRadius: 14 }}><Txt>{countryName(residency, language)}</Txt><Txt kind="label">{residency.toUpperCase()}</Txt></Row></Pressable>
      <View style={{ gap: 8 }}><Txt kind="label">{t('currency')}</Txt><Row style={{ flexWrap: 'wrap' }}>{['USD','AED','SAR','EUR'].map(code => <Pressable key={code} accessibilityRole="radio" accessibilityState={{ checked: code === currency }} onPress={() => setCurrency(code)} style={{ flex: 1, minHeight: 46, justifyContent: 'center', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: currency === code ? colors.blueStrong : colors.border, backgroundColor: currency === code ? colors.softBlue : '#fff' }}><Txt kind="label" style={{ color: currency === code ? colors.blueStrong : colors.muted }}>{code}</Txt></Pressable>)}</Row></View>
      {submitted && (errors.residency || errors.guests) && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t(errors.residency ? 'residencyError' : 'guestsError')}</Txt>}
      <Button title={t('search')} onPress={submit} />
    </View><View style={{ paddingHorizontal: 5, gap: 7 }}><Txt kind="label">{t('sandboxBody')}</Txt><Txt kind="small">{t('foundationNote')}</Txt></View></View>
  </ScrollView>{calendar !== null && <CalendarPicker visible title={t(calendar || 'checkin')} value={calendar === 'checkout' ? checkout : checkin} min={calendar === 'checkout' && validDate(checkin) ? addDays(checkin, 1) : todayDate()} max={calendar === 'checkout' && validDate(checkin) ? addDays(checkin, 30) : addDays(todayDate(), 730)} onClose={() => setCalendar(null)} onSelect={value => { if (calendar === 'checkin') { setCheckin(value); if (!validDate(checkout) || checkout <= value || checkout > addDays(value, 30)) setCheckout(addDays(value, 1)); } else setCheckout(value); setErrors(current => ({ ...current, dates: false })); }} />}{guestOpen && <GuestPicker visible value={guests} onClose={() => showGuests(false)} onChange={setGuests} />}<CountryPicker visible={countryOpen} value={residency} onClose={() => showCountry(false)} onChange={setResidency} /></SafeAreaView>;
}
