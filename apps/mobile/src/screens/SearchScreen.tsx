import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { api, COUNTRY_CODES, validateSearchCriteria } from '../api';
import type { SearchCriteria, Suggestion } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts, localizedFont, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import { hotelId } from '../api/validation';
import DiscoveryShelves, { DiscoveryHero } from '../components/DiscoveryShelves';
import ApiState from '../components/ApiState';
import { Button, Icon, Row, StatePanel, Txt } from '../components/Primitives';
import CalendarPicker from '../components/CalendarPicker';
import GuestPicker from '../components/GuestPicker';
import CountryPicker, { countryName } from '../components/CountryPicker';
import { copyGuestRooms, destinationFromSearch, displayTravelDate, quickStayDates, recentSearchDraft, shouldSuggestDestination, stayNights, type QuickStay } from '../components/searchJourneyModel';
import { searchCopy } from './searchCopy';

type TravelDraft = Pick<SearchCriteria, 'checkin' | 'checkout' | 'guests' | 'residency' | 'currency'>;

function initialTravel(criteria: SearchCriteria | null): TravelDraft {
  return {
    checkin: criteria?.checkin || '', checkout: criteria?.checkout || '',
    guests: copyGuestRooms(criteria?.guests || [{ adults: 2, children: [] }]),
    residency: criteria?.residency || 'ae', currency: criteria?.currency || 'USD',
  };
}

export default function SearchScreen({ savedOnly = false }: { savedOnly?: boolean }) {
  const { t, language, rtl } = useLanguage(); const router = useRouter(); const state = useAppState(); const copy = searchCopy(language);
  const [query, setQuery] = useState(state.destinationName); const [selected, select] = useState<Suggestion | null>(() => destinationFromSearch(state.criteria, state.destinationName));
  const [suggestionResult, setSuggestionResult] = useState<{ key: string; values: Suggestion[]; error: unknown }>({ key: '', values: [], error: null });
  const [suggestionRetry, retrySuggestion] = useState(0);
  const suggestionKey = `${language}:${query}:${suggestionRetry}`;
  const suggestions = suggestionResult.key === suggestionKey ? suggestionResult.values : [];
  const needsSuggestions = !savedOnly && shouldSuggestDestination(query, selected);
  const suggesting = needsSuggestions && suggestionResult.key !== suggestionKey;
  const suggestError = suggestionResult.key === suggestionKey && suggestionResult.error;
  const [draft, setDraft] = useState(() => ({ source: state.criteria, value: initialTravel(state.criteria) }));
  // Applying travel details elsewhere updates the dates on Explore and retains its destination input.
  const travel = draft.source === state.criteria ? draft.value : initialTravel(state.criteria);
  const { checkin, checkout, guests, residency, currency } = travel;
  const updateTravel = (changes: Partial<TravelDraft>) => setDraft(previous => ({
    source: state.criteria, value: { ...(previous.source === state.criteria ? previous.value : initialTravel(state.criteria)), ...changes },
  }));
  const [calendar, setCalendar] = useState<{ field: 'checkin' | 'checkout'; source: SearchCriteria | null } | null>(null);
  const [guestEditor, setGuestEditor] = useState<{ source: SearchCriteria | null } | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [preferences, setPreferences] = useState(false);
  const [countryOpen, showCountry] = useState(false); const [errors, setErrors] = useState<Record<string, boolean>>({}); const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    if (!needsSuggestions) return;
    const controller = new AbortController();
    const timer = setTimeout(() => { api.searchSuggestions(query.trim(), language, controller.signal).then(values => { if (!controller.signal.aborted) setSuggestionResult({ key: suggestionKey, values, error: null }); }).catch(error => { if (!controller.signal.aborted) setSuggestionResult({ key: suggestionKey, values: [], error }); }); }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, language, suggestionKey, needsSuggestions]);
  const savedIds = state.saved.filter(id => hotelId(id) !== null);
  const submit = () => {
    const destination = selected?.name === query ? selected : query === state.destinationName ? destinationFromSearch(state.criteria, query) : null;
    const criteria: SearchCriteria = { checkin, checkout, guests: copyGuestRooms(guests), residency, currency, language, ...(savedOnly ? { hids: savedIds } : destination?.regionId ? { regionId: destination.regionId } : destination?.hid ? { hids: [destination.hid] } : {}) };
    const validation = validateSearchCriteria(criteria); const next = { destination: savedOnly ? !savedIds.length : !destination || !query.trim(), dates: validation.errors.includes('invalid_checkin') || validation.errors.includes('invalid_checkout'), residency: !COUNTRY_CODES.includes(residency), guests: validation.errors.includes('invalid_guests') };
    setErrors(next); setSubmitted(true);
    if (!validation.valid || Object.values(next).some(Boolean)) return;
    Keyboard.dismiss();
    if (savedOnly) {
      state.setSavedSearch(criteria);
      router.dismissTo('/saved');
    } else {
      state.setSearch(criteria, query.trim());
      router.push('/results');
    }
  };
  const restoreRecent = (id: string) => {
    // Re-resolve ownership at press time: an old session's rendered handler
    // must not restore a record after logout or same-account reauthentication.
    const recent = state.getRecentSearches().find(value => value.id === id);
    if (!recent) return;
    const draft = recentSearchDraft(recent); if (!draft) return;
    setQuery(draft.query); select(draft.selected); updateTravel({ checkin: draft.checkin, checkout: draft.checkout,
      guests: draft.guests, residency: draft.residency, currency: draft.currency });
    setErrors({}); setSubmitted(false); setSuggestionResult({ key: '', values: [], error: null }); Keyboard.dismiss();
  };
  const chooseQuickStay = (kind: QuickStay) => {
    const dates = quickStayDates(kind); updateTravel(dates);
    setErrors(current => ({ ...current, dates: false }));
  };
  const nights = stayNights(checkin, checkout);
  const adults = guests.reduce((sum, room) => sum + room.adults, 0); const childCount = guests.reduce((sum, room) => sum + room.children.length, 0);
  const guestSummary = copy.guests(adults, childCount, guests.length);
  const chooseDubai = () => {
    setQuery(rtl ? 'دبي' : 'Dubai'); select(null); setSubmitted(false);
    scroll.current?.scrollTo({ y: 0, animated: true });
  };
  if (savedOnly && (!state.savedReady || !savedIds.length)) {
    return <SafeAreaView edges={['top','bottom']} style={ui.screen}><BrandHeader back/>
      <View style={ui.page}><StatePanel title={t(state.savedLoading ? 'loading' : state.savedError ? 'savedError' : 'saved')}
        busy={state.savedLoading}/><Button title={t('saved')} onPress={() => router.dismissTo('/saved')}/></View>
    </SafeAreaView>;
  }
  return <SafeAreaView edges={savedOnly ? ['top','bottom'] : ['top']} style={ui.screen}><BrandHeader back={savedOnly} /><ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'} contentContainerStyle={{ paddingBottom: 28 }}>
    <View style={[ui.page, { paddingTop: 10, gap: 12 }]}>
    {!savedOnly && <DiscoveryHero chooseDubai={chooseDubai}/>}
    <View testID="search-form" style={[ui.card, ui.shadow, styles.form]}>
      {savedOnly && <Txt kind="heading" accessibilityRole="header">{t('savedDatesTitle')}</Txt>}
      {!savedOnly && <View style={{ gap: 4 }}>
        <Row style={styles.fieldRow}><Icon name="pin" size={22}/>
          <View style={{ flex: 1 }}><Txt kind="small">{t('destination')}</Txt>
            <TextInput testID="search-destination" accessibilityLabel={t('destination')} accessibilityHint={errors.destination ? t('pickDestination') : undefined}
              value={query} onChangeText={value => { setQuery(value); select(null); setSubmitted(false); setErrors(current => ({ ...current, destination: false })); }}
              placeholder={t('destinationHint')} placeholderTextColor={colors.muted} autoCorrect={false} returnKeyType="search"
              style={[styles.destination, { fontFamily: localizedFont(language, fonts.bold), textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}/>
          </View>
        </Row>
        {errors.destination && <Txt kind="small" accessibilityRole="alert" style={{ color: colors.red }}>{t('pickDestination')}</Txt>}
        {suggesting && <Txt kind="small" accessibilityLiveRegion="polite">{t('loading')}</Txt>}
        {!suggesting && needsSuggestions && (suggestError ? <ApiState error={suggestError} retry={() => retrySuggestion(value => value + 1)} /> : suggestions.length === 0 ? <Txt kind="small">{t('noSuggestions')}</Txt> : <View style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 14, overflow: 'hidden' }}>{suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}${item.subtitle ? `, ${item.subtitle}` : ''}`} onPress={() => { select(item); setQuery(item.name); setErrors(current => ({ ...current, destination: false })); Keyboard.dismiss(); }} style={{ minHeight: 60, padding: 13, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border }}><Row><Icon name="search" color={colors.blueStrong} size={18} /><View style={{ flex: 1 }}><Txt style={{ fontFamily: fonts.bold }}>{item.name}</Txt>{item.subtitle && <Txt kind="small">{item.subtitle}</Txt>}</View></Row></Pressable>)}</View>)}
      </View>}
      {!savedOnly && <View style={ui.rule}/>}
      <Row style={styles.fieldRow}><Icon name="calendar" size={22}/>
       <Row style={{ flex: 1, alignItems: 'stretch', gap: 10 }}>{(['checkin', 'checkout'] as const).map((key, index) =>
        <Pressable key={key} testID={`search-date-${key}`} accessibilityRole="button"
          onPress={() => { Keyboard.dismiss(); setCalendar({ field: key, source: state.criteria }); }}
          style={[styles.dateControl, index === 1 && { [rtl ? 'borderRightWidth' : 'borderLeftWidth']: 1, borderColor: colors.border, [rtl ? 'paddingRight' : 'paddingLeft']: 10 }]}>
          <Txt kind="small">{t(key)}</Txt>
          <Txt kind="label" style={{ color: errors.dates ? colors.red : colors.ink }}>
            {displayTravelDate(key === 'checkin' ? checkin : checkout, language) || t('selectDate')}
          </Txt>
        </Pressable>)}</Row></Row>
      {errors.dates && <Txt accessibilityRole="alert" kind="small" style={{ color: colors.red }}>{t('datesError')}</Txt>}
      <View style={ui.rule}/>
      <Pressable testID="search-guests" accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setGuestEditor({ source: state.criteria }); }}
        style={{ minHeight: 56, justifyContent: 'center' }}>
        <Row style={styles.fieldRow}><Icon name="users" size={22}/><View style={{ flex: 1 }}>
          <Txt kind="small">{t('guests')}</Txt><Txt kind="label">{guestSummary}</Txt></View><Icon name="chevron" size={16}/></Row>
      </Pressable>
      {submitted && (errors.residency || errors.guests) && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t(errors.residency ? 'residencyError' : 'guestsError')}</Txt>}
      <View testID="search-submit" style={{ marginTop: 5 }}><Button title={savedOnly ? t('applyStayDates') : rtl ? 'ابحث عن فنادق' : 'Search hotels'} onPress={submit}
        hint={nights !== null ? copy.nights(nights) : undefined}/></View>
    </View>
    <View style={{ gap: 5 }}><Txt kind="heading" accessibilityRole="header">{rtl ? 'تواريخ سريعة' : 'Quick dates'}</Txt><Row style={styles.quickRow}>
      {(['tonight','tomorrow','nextWeek'] as const).map(kind => {
        const dates = quickStayDates(kind); const chosen = dates.checkin === checkin && dates.checkout === checkout;
        return <Pressable key={kind} accessibilityRole="button" accessibilityLabel={copy[kind]} aria-pressed={chosen} accessibilityState={{ selected: chosen }}
          onPress={() => chooseQuickStay(kind)} style={[styles.quickOption, {
            borderColor: chosen ? colors.navy : colors.border, backgroundColor: chosen ? colors.softBlue : colors.surface }]}>
          <Txt kind="label">{({ tonight: rtl ? 'الليلة' : 'Tonight', tomorrow: rtl ? 'غداً' : 'Tomorrow', nextWeek: rtl ? 'الأسبوع المقبل' : 'Next week' })[kind]}</Txt>
          <Txt kind="small">{displayTravelDate(dates.checkin, language)}</Txt></Pressable>;
      })}
    </Row></View>
    {!savedOnly && <DiscoveryShelves/>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: preferences }} aria-expanded={preferences}
      onPress={() => setPreferences(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Row style={{ gap: 8 }}><Icon name="filter" size={18}/><View style={{ flex: 1 }}><Txt kind="label">{rtl ? 'إعدادات البحث' : 'Search settings'}</Txt>
        <Txt kind="small">{countryName(residency, language)} · {currency}</Txt></View><Txt kind="heading">{preferences ? '−' : '+'}</Txt></Row>
    </Pressable>
    {preferences && <View style={ui.card}>
      <Pressable accessibilityRole="button" onPress={() => showCountry(true)} style={{ minHeight: 48 }}>
        <Txt kind="small">{t('residency')}</Txt><Txt kind="label">{countryName(residency, language)}</Txt>
      </Pressable>
      <View accessibilityRole="radiogroup" accessibilityLabel={t('currency')} style={{ gap: 6 }}><Txt kind="small">{t('currency')}</Txt>
        <Row style={{ gap: 5 }}>{['USD','AED','SAR','EUR'].map(code => <Pressable key={code}
          accessibilityRole="radio" aria-checked={code === currency} accessibilityState={{ checked: code === currency }}
          onPress={() => updateTravel({ currency: code })} style={{ flex: 1, minHeight: 44, justifyContent: 'center', alignItems: 'center',
            borderRadius: 22, borderWidth: 1, borderColor: colors.border, backgroundColor: currency === code ? colors.lilac : colors.surface }}>
          <Txt kind="label">{code}</Txt></Pressable>)}</Row>
      </View>
    </View>}
    {!savedOnly && state.recentSearches.length > 0 && <View style={[ui.card, { padding: 16 }]}><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt kind="heading" accessibilityRole="header">{copy.recent}</Txt><Pressable accessibilityRole="button" accessibilityLabel={`${t('clear')} · ${copy.clearRecent}`} onPress={state.clearRecentSearches} style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 12 }}><Txt kind="label" style={{ color: colors.blueStrong }}>{t('clear')}</Txt></Pressable></Row><Txt kind="small">{copy.recentBody}</Txt>{state.recentSearches.map(recent => <Pressable key={recent.id} accessibilityRole="button" accessibilityHint={copy.recentHint} onPress={() => restoreRecent(recent.id)} style={{ minHeight: 72, padding: 14, gap: 6, backgroundColor: colors.background, borderRadius: 14 }}><Txt kind="label">{recent.name}</Txt><Txt kind="small" style={{ writingDirection: 'ltr' }}>{recent.criteria.checkin} → {recent.criteria.checkout}</Txt></Pressable>)}</View>}
    </View>
  </ScrollView>
    {calendar && calendar.source === state.criteria && <CalendarPicker initialField={calendar.field} checkin={checkin} checkout={checkout}
      onClose={() => setCalendar(null)} onSelect={dates => {
        updateTravel(dates);
        setErrors(current => ({ ...current, dates: false }));
        setCalendar(null);
      }}/>}
    {guestEditor && guestEditor.source === state.criteria && <GuestPicker visible value={guests}
      onClose={() => setGuestEditor(null)} onChange={rooms => {
        updateTravel({ guests: rooms });
        setErrors(current => ({ ...current, guests: false }));
      }}/>}
    <CountryPicker visible={countryOpen} value={residency} onClose={() => showCountry(false)} onChange={residency => updateTravel({ residency })} />
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  form: { padding: 14, gap: 3 },
  fieldRow: { gap: 12, minHeight: 54 },
  destination: { color: colors.ink, minHeight: 48, fontSize: 16, lineHeight: 23, paddingHorizontal: 0, paddingVertical: 2 },
  dateControl: { flex: 1, minHeight: 48, justifyContent: 'center' },
  quickRow: { gap: 7, alignItems: 'stretch', flexWrap: 'wrap' },
  quickOption: { flex: 1, minWidth: 78, minHeight: 54, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1 },
});
