import React, { useCallback, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, APP_ENV, authSession, COUNTRY_CODES, validateSearchCriteria } from '../api';
import { useAuth } from '../auth';
import type { SearchCriteria, Suggestion } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts, localizedFont, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import { hotelId } from '../api/validation';
import DiscoveryShelves, { DestinationPicks, DiscoveryHero } from '../components/DiscoveryShelves';
import ApiState from '../components/ApiState';
import { Button, Icon, Row, StatePanel, Txt } from '../components/Primitives';
import CalendarPicker from '../components/CalendarPicker';
import GuestPicker from '../components/GuestPicker';
import CountryPicker, { countryName } from '../components/CountryPicker';
import { copyGuestRooms, destinationFromSearch, destinationLookupName, displayTravelDate, quickStayDates, recentSearchDraft, resolveFeaturedCity, shouldSuggestDestination, stayNights, type DestinationId, type QuickStay } from '../components/searchJourneyModel';
import { searchCopy } from './searchCopy';
import CurrencyPicker from '../components/CurrencyPicker';
import { bookingCurrency, currencyName } from '../components/currencyCatalog';
import { useCurrencyPreference } from '../components/useCurrencyPreference';

type TravelDraft = Pick<SearchCriteria, 'checkin' | 'checkout' | 'guests' | 'residency'>;

function initialTravel(criteria: SearchCriteria | null): TravelDraft {
  return {
    checkin: criteria?.checkin || '', checkout: criteria?.checkout || '',
    guests: copyGuestRooms(criteria?.guests || [{ adults: 2, children: [] }]),
    residency: criteria?.residency || 'ae',
  };
}

export default function SearchScreen({ savedOnly = false }: { savedOnly?: boolean }) {
  const { t, language, rtl } = useLanguage(); const router = useRouter(); const state = useAppState(); const copy = searchCopy(language);
  const { fontScale, width } = useWindowDimensions();
  const [query, setQuery] = useState(state.destinationName); const [selected, select] = useState<Suggestion | null>(() => destinationFromSearch(state.criteria, state.destinationName));
  const [featuredCity, setFeaturedCity] = useState<DestinationId>('dubai');
  const [pickedCity, setPickedCity] = useState<DestinationId | null>(null);
  const [allRecent, setAllRecent] = useState(false);
  const [suggestionResult, setSuggestionResult] = useState<{ key: string; values: Suggestion[]; error: unknown }>({ key: '', values: [], error: null });
  const [suggestionRetry, retrySuggestion] = useState(0);
  const { status: authStatus, sessionRevision } = useAuth();
  const suggestionKey = JSON.stringify([sessionRevision, authStatus, language, query.trim(), pickedCity, suggestionRetry]);
  const suggestions = suggestionResult.key === suggestionKey ? suggestionResult.values : [];
  const needsSuggestions = !savedOnly && shouldSuggestDestination(query, selected);
  const suggesting = needsSuggestions && suggestionResult.key !== suggestionKey;
  const suggestError = suggestionResult.key === suggestionKey && suggestionResult.error;
  const [draft, setDraft] = useState(() => ({ source: state.criteria, value: initialTravel(state.criteria) }));
  // Applying travel details elsewhere updates the dates on Explore and retains its destination input.
  const travel = draft.source === state.criteria ? draft.value : initialTravel(state.criteria);
  const { checkin, checkout, guests, residency } = travel;
  const preference = useCurrencyPreference();
  const currency = bookingCurrency(preference.currency, APP_ENV);
  const [currencyOpen, showCurrency] = useState(false);
  const currencySource = preference.source === 'manual' ? (rtl ? 'اختيارك' : 'Your choice')
    : preference.source === 'network' ? (rtl ? 'حسب بلد الاتصال' : 'Network country')
    : preference.source === 'device' ? (rtl ? 'حسب إعداد الجهاز' : 'Device region')
    : preference.detecting ? (rtl ? 'جارٍ التحديد' : 'Detecting') : (rtl ? 'افتراضي' : 'Default');
  const updateTravel = (changes: Partial<TravelDraft>) => setDraft(previous => ({
    source: state.criteria, value: { ...(previous.source === state.criteria ? previous.value : initialTravel(state.criteria)), ...changes },
  }));
  const [calendar, setCalendar] = useState<{ field: 'checkin' | 'checkout'; source: SearchCriteria | null } | null>(null);
  const [guestEditor, setGuestEditor] = useState<{ source: SearchCriteria | null } | null>(null);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const formTop = useRef(0);
  const [destinationFocused, setDestinationFocused] = useState(false);
  const [preferences, setPreferences] = useState(false);
  const [countryOpen, showCountry] = useState(false); const [errors, setErrors] = useState<Record<string, boolean>>({}); const [submitted, setSubmitted] = useState(false);
  useFocusEffect(useCallback(() => {
    if (!needsSuggestions || authStatus === 'loading') return;
    const controller = new AbortController();
    const current = () => !controller.signal.aborted && authSession.getRevision() === sessionRevision
      && authSession.getSnapshot().status === authStatus;
    setSuggestionResult({ key: '', values: [], error: null });
    const timer = setTimeout(() => {
      api.searchSuggestions(pickedCity ? destinationLookupName(query) : query, language, controller.signal).then(values => {
        if (!current()) return;
        const match = pickedCity && resolveFeaturedCity(pickedCity, values);
        if (match) {
          select({ ...match, name: query });
          setErrors(previous => ({ ...previous, destination: false }));
        }
        setSuggestionResult({ key: suggestionKey, values, error: null });
      }).catch(error => {
        if (current()) setSuggestionResult({ key: suggestionKey, values: [], error });
      });
    }, pickedCity ? 0 : 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, language, suggestionKey, needsSuggestions, authStatus, sessionRevision, pickedCity, setErrors]));
  const savedIds = state.saved.filter(id => hotelId(id) !== null);
  const submit = () => {
    if (!preference.ready) return;
    const destination = selected?.name === query ? selected : !pickedCity && query === state.destinationName ? destinationFromSearch(state.criteria, query) : null;
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
  const returnToForm = () => scroll.current?.scrollTo({ y: Math.max(0, formTop.current - 8), animated: false });
  const restoreRecent = (id: string) => {
    // Re-resolve ownership at press time: an old session's rendered handler
    // must not restore a record after logout or same-account reauthentication.
    const recent = state.getRecentSearches().find(value => value.id === id);
    if (!recent) return;
    const draft = recentSearchDraft(recent); if (!draft) return;
    setPickedCity(null); setQuery(draft.query); select(draft.selected); updateTravel({ checkin: draft.checkin, checkout: draft.checkout,
      guests: draft.guests, residency: draft.residency });
    setErrors({}); setSubmitted(false); setSuggestionResult({ key: '', values: [], error: null }); Keyboard.dismiss(); returnToForm();
  };
  const chooseQuickStay = (kind: QuickStay) => {
    const dates = quickStayDates(kind); updateTravel(dates);
    setErrors(current => ({ ...current, dates: false }));
    returnToForm();
  };
  const nights = stayNights(checkin, checkout);
  const adults = guests.reduce((sum, room) => sum + room.adults, 0); const childCount = guests.reduce((sum, room) => sum + room.children.length, 0);
  const guestSummary = copy.guests(adults, childCount, guests.length);
  const chooseDestination = (id: DestinationId, name: string) => {
    setFeaturedCity(id); setPickedCity(id); setQuery(name); select(null); setSubmitted(false);
    setErrors(previous => ({ ...previous, destination: false }));
    returnToForm();
  };
  if (savedOnly && (!state.savedReady || !savedIds.length)) {
    return <SafeAreaView edges={['top','bottom']} style={ui.screen}><BrandHeader back/>
      <View style={ui.page}><StatePanel title={t(state.savedLoading ? 'loading' : state.savedError ? 'savedError' : 'saved')}
        busy={state.savedLoading}/><Button title={t('saved')} onPress={() => router.dismissTo('/saved')}/></View>
    </SafeAreaView>;
  }
  return <SafeAreaView edges={savedOnly ? ['top','bottom'] : ['top']} style={ui.screen}><BrandHeader back={savedOnly} /><ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'} contentContainerStyle={{ paddingBottom: 28 }}>
    <View style={[ui.page, { paddingTop: savedOnly ? 12 : 0, gap: 18 }]}>
    {!savedOnly && <View style={{marginHorizontal:-8}}><DiscoveryHero cityId={featuredCity} preview={setFeaturedCity} choose={chooseDestination}/></View>}
    <View testID="search-form" onLayout={event => { formTop.current = event.nativeEvent.layout.y; }}
      style={[ui.card, ui.shadow, styles.form, !savedOnly && styles.insetForm]}>
      {savedOnly && <Txt kind="heading" accessibilityRole="header">{t('savedDatesTitle')}</Txt>}
      {!savedOnly && <View style={{ gap: 4 }}>
        <Row style={{...styles.destinationRow, borderColor: errors.destination ? colors.red : destinationFocused ? colors.grape : colors.border}}>
          <View style={styles.destinationIcon}><Icon name="pin" size={20} color={colors.violetInk}/></View>
          <View style={{ flex: 1 }}><Txt kind="small" style={styles.fieldCaption}>{rtl ? 'الوجهة' : 'Destination'}</Txt>
            <TextInput testID="search-destination" accessibilityLabel={t('destination')} accessibilityHint={errors.destination ? t('pickDestination') : undefined}
              onFocus={() => setDestinationFocused(true)} onBlur={() => setDestinationFocused(false)}
              value={query} onChangeText={value => { setPickedCity(null); setQuery(value); select(null); setSubmitted(false); setErrors(current => ({ ...current, destination: false })); }}
              placeholder={t('destinationHint')} placeholderTextColor={colors.muted} autoCorrect={false} returnKeyType="search"
              style={[styles.destination, { fontFamily: localizedFont(language, fonts.bold), textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}/>
          </View>
        </Row>
        {errors.destination && <Txt kind="small" accessibilityRole="alert" style={{ color: colors.red }}>{t('pickDestination')}</Txt>}
        {suggesting && <Txt kind="small" accessibilityLiveRegion="polite">{t('loading')}</Txt>}
        {!suggesting && needsSuggestions && (suggestError ? <ApiState error={suggestError} retry={() => retrySuggestion(value => value + 1)} /> : suggestions.length === 0 ? <Txt kind="small">{t('noSuggestions')}</Txt> : <View style={styles.suggestions}>{suggestions.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={`${item.name}${item.subtitle ? `, ${item.subtitle}` : ''}`} onPress={() => { select(item); setQuery(item.name); setErrors(current => ({ ...current, destination: false })); Keyboard.dismiss(); }} style={styles.suggestion}><Row><Icon name={item.type === 'region' ? 'pin' : 'bed'} color={colors.violetInk} size={19} /><View style={{ flex: 1 }}><Txt kind="label">{item.name}</Txt>{item.subtitle && <Txt kind="small">{item.subtitle}</Txt>}</View><Icon name="chevron" size={14}/></Row></Pressable>)}</View>)}
      </View>}
      <Row style={{ alignItems: 'stretch', gap: 8, ...(fontScale > 1.4 || width < 335 ? {flexDirection:'column'} : {}) }}>{(['checkin', 'checkout'] as const).map(key =>
        <Pressable key={key} testID={`search-date-${key}`} accessibilityRole="button"
          onPress={() => { Keyboard.dismiss(); setCalendar({ field: key, source: state.criteria }); }}
          style={({pressed}) => [styles.dateControl, {backgroundColor:pressed ? colors.pistachio : colors.pistachioMist}]}>
          <Row style={{gap:6}}><Icon name="calendar" size={15} color={colors.leafInk}/><Txt kind="small" style={[styles.fieldCaption,{color:colors.leafInk}]}>{t(key)}</Txt></Row>
          <Txt kind="label" style={[styles.fieldValue, { color: errors.dates ? colors.red : colors.ink }]}>
            {displayTravelDate(key === 'checkin' ? checkin : checkout, language) || t('selectDate')}
          </Txt>
        </Pressable>)}</Row>
      {errors.dates && <Txt accessibilityRole="alert" kind="small" style={{ color: colors.red }}>{t('datesError')}</Txt>}
      <Pressable testID="search-guests" accessibilityRole="button" onPress={() => { Keyboard.dismiss(); setGuestEditor({ source: state.criteria }); }}
        style={({pressed}) => [styles.guestControl, pressed && {backgroundColor:colors.background}]}>
        <Row style={styles.fieldRow}><Icon name="users" size={19} color={colors.muted}/><View style={{ flex: 1 }}>
          <Txt kind="small" style={styles.fieldCaption}>{t('guests')}</Txt><Txt kind="label" style={styles.fieldValue}>{guestSummary}</Txt></View><Icon name="chevron" size={15}/></Row>
      </Pressable>
      {submitted && (errors.residency || errors.guests) && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t(errors.residency ? 'residencyError' : 'guestsError')}</Txt>}
      <Pressable testID="search-currency" accessibilityRole="button" onPress={() => showCurrency(true)}
        style={({pressed}) => [styles.currencyControl, pressed && {backgroundColor:colors.lavenderMist}]}>
        <Row style={{gap:9}}><View style={{flex:1}}>
          <Txt kind="small">{rtl ? 'عملة الأسعار' : 'Price currency'}</Txt>
          <Txt kind="label">{currencyName(preference.currency, language)} · {preference.currency}</Txt>
        </View><Txt kind="small">{currencySource}</Txt><Icon name="chevron" size={15}/></Row>
      </Pressable>
      {preference.saveFailed && <Txt kind="small" accessibilityRole="alert">{rtl ? 'تعذّر حفظ العملة على الجهاز. ينطبق اختيارك على هذه الجلسة.' : 'Could not save your currency on this device. It applies for this session.'}</Txt>}
      {currency !== preference.currency && <Txt kind="small">{rtl ? 'نعرض تقديراً بالعملة المختارة عند توفر سعر صرف حديث. عملة الحجز هي الدولار الأمريكي (USD).' : 'A recent exchange rate is used for estimates when available. Your booking currency is USD.'}</Txt>}
      <View testID="search-submit"><Pressable accessibilityRole="button" accessibilityState={{disabled:!preference.ready}} disabled={!preference.ready}
        accessibilityLabel={savedOnly ? t('applyStayDates') : rtl ? 'ابحث عن فنادق' : 'Search hotels'}
        accessibilityHint={nights !== null ? copy.nights(nights) : undefined} onPress={submit}
        style={({pressed}) => [styles.submit, {backgroundColor:pressed ? colors.blue : colors.primary}]}>
        <Row style={{gap:9, justifyContent:'center'}}><Icon name={savedOnly ? 'check' : 'search'} size={18} color={colors.surface}/>
          <Txt kind="label" style={styles.submitText}>{savedOnly ? t('applyStayDates') : rtl ? 'ابحث عن فنادق' : 'Search hotels'}</Txt>
          {nights !== null && !savedOnly && <Txt kind="small" style={styles.stayLength}>{copy.nights(nights)}</Txt>}</Row>
      </Pressable></View>
    </View>
    {!savedOnly && state.recentSearches.length > 0 && <View style={{gap:8}}>
      <Row style={{justifyContent:'space-between', flexWrap:'wrap', gap:4}}>
        <Txt kind="heading" accessibilityRole="header">{copy.recent}</Txt>
        <Pressable accessibilityRole="button" accessibilityLabel={copy.clearRecent} onPress={state.clearRecentSearches} style={styles.textAction}>
          <Txt kind="label" style={{color:colors.muted}}>{t('clear')}</Txt>
        </Pressable>
      </Row>
      {(allRecent ? state.recentSearches : state.recentSearches.slice(0,1)).map(recent => <Pressable key={recent.id}
        testID="restore-recent-search" accessibilityRole="button" accessibilityHint={copy.recentHint} onPress={() => restoreRecent(recent.id)}
        style={({pressed}) => [styles.recentCard, pressed && {backgroundColor:colors.pistachioMist}]}>
        <Row><View style={styles.recentIcon}><Icon name="clock" color={colors.leafInk} size={21}/></View>
          <View style={{flex:1}}><Txt kind="label" style={styles.fieldValue}>{recent.name}</Txt>
            <Txt kind="small">{displayTravelDate(recent.criteria.checkin, language)} – {displayTravelDate(recent.criteria.checkout, language)}</Txt>
          </View><Icon name="chevron" size={16}/>
        </Row>
      </Pressable>)}
      {state.recentSearches.length > 1 && <Pressable accessibilityRole="button" accessibilityState={{expanded:allRecent}} aria-expanded={allRecent}
        onPress={() => setAllRecent(previous => !previous)} style={styles.textAction}>
        <Txt kind="label" style={{color:colors.violetInk}}>{allRecent ? t('less') : copy.showRecent(state.recentSearches.length)}</Txt>
      </Pressable>}
    </View>}
    {!savedOnly && <DestinationPicks choose={chooseDestination}/>}
    <View style={{ gap: 5 }}><Txt kind="heading" accessibilityRole="header">{rtl ? 'تواريخ سريعة' : 'Quick dates'}</Txt><Row style={styles.quickRow}>
      {(['tonight','tomorrow','nextWeek'] as const).map(kind => {
        const dates = quickStayDates(kind); const chosen = dates.checkin === checkin && dates.checkout === checkout;
        return <Pressable key={kind} testID={'quick-stay-' + kind} accessibilityRole="button" accessibilityLabel={copy[kind]} aria-pressed={chosen} accessibilityState={{ selected: chosen }}
          onPress={() => chooseQuickStay(kind)} style={[styles.quickOption, {
            borderColor: chosen ? colors.navy : colors.border, backgroundColor: chosen ? colors.softBlue : colors.surface }]}>
          <Txt kind="label">{({ tonight: rtl ? 'الليلة' : 'Tonight', tomorrow: rtl ? 'غداً' : 'Tomorrow', nextWeek: rtl ? 'الأسبوع المقبل' : 'Next week' })[kind]}</Txt>
          <Txt kind="small">{displayTravelDate(dates.checkin, language)}</Txt></Pressable>;
      })}
    </Row></View>
    {!savedOnly && <DiscoveryShelves/>}
    {!savedOnly && <Pressable accessibilityRole="button" onPress={() => router.push('/membership')} style={styles.membership}>
      <Row style={{gap:10}}><Icon name="account" size={18} color={colors.violetInk}/><View style={{flex:1}}><Txt kind="label">{rtl ? 'العضوية وأسعار الأعضاء' : 'Membership and private rates'}</Txt></View><Icon name="chevron" size={16}/></Row>
    </Pressable>}
    <Pressable accessibilityRole="button" accessibilityState={{ expanded: preferences }} aria-expanded={preferences}
      onPress={() => setPreferences(value => !value)} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Row style={{ gap: 8 }}><Icon name="filter" size={18}/><View style={{ flex: 1 }}><Txt kind="label">{rtl ? 'إعدادات البحث' : 'Search settings'}</Txt>
        <Txt kind="small">{countryName(residency, language)}</Txt></View><Txt kind="heading">{preferences ? '−' : '+'}</Txt></Row>
    </Pressable>
    {preferences && <View style={ui.card}>
      <Pressable accessibilityRole="button" onPress={() => showCountry(true)} style={{ minHeight: 48 }}>
        <Txt kind="small">{t('residency')}</Txt><Txt kind="label">{countryName(residency, language)}</Txt>
      </Pressable>
    </View>}
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
    <CurrencyPicker visible={currencyOpen} value={preference.currency} automatic={preference.source !== 'manual'}
      onClose={() => showCurrency(false)} onChange={preference.choose} onAutomatic={preference.useAutomatic}/>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  currencyControl: { minHeight: 48, paddingHorizontal: 9, paddingVertical: 4, justifyContent:'center', borderRadius:12 },
  form: { padding:12, gap:8, borderRadius:22 },
  insetForm: { marginTop:-31 },
  fieldRow: { gap:11, minHeight:45 },
  fieldCaption: { fontSize:13, lineHeight:19, color:colors.muted },
  fieldValue: { fontSize:16, lineHeight:23 },
  destinationRow: { paddingHorizontal:10, paddingTop:4, minHeight:67, gap:10, borderRadius:13, borderWidth:1, backgroundColor:colors.surface },
  destinationIcon: { width:36, height:36, borderRadius:12, backgroundColor:colors.lavenderMist, alignItems:'center', justifyContent:'center' },
  destination: { color:colors.ink, minHeight:44, fontSize:18, lineHeight:25, paddingHorizontal:0, paddingVertical:0 },
  dateControl: { flex:1, gap:2, minHeight:54, borderRadius:12, justifyContent:'center', paddingHorizontal:10, paddingVertical:5 },
  guestControl: { minHeight:48, justifyContent:'center', paddingHorizontal:10, borderRadius:10 },
  submit: { minHeight:50, borderRadius:14, alignItems:'center', justifyContent:'center', padding:8 },
  submitText: { color:colors.surface, fontSize:16, lineHeight:24, textAlign:'center', flexShrink:1 },
  stayLength: { color:colors.pistachio, fontSize:14, lineHeight:22 },
  recentCard: { minHeight:64, justifyContent:'center', paddingHorizontal:12, paddingVertical:9, backgroundColor:colors.surface, borderRadius:16, borderColor:colors.border, borderWidth:1 },
  recentIcon: { width:36, height:36, backgroundColor:colors.pistachioMist, borderRadius:18, alignItems:'center', justifyContent:'center' },
  textAction: { minHeight:44, justifyContent:'center', paddingHorizontal:5 },
  suggestions: { borderWidth:1, borderColor:colors.border, borderRadius:14, overflow:'hidden' },
  suggestion: { minHeight:58, padding:12, justifyContent:'center', borderBottomWidth:StyleSheet.hairlineWidth, borderBottomColor:colors.border },
  membership: { minHeight:52, justifyContent:'center', paddingHorizontal:14, borderRadius:16, backgroundColor:colors.lavenderMist },
  quickRow: { gap: 7, alignItems: 'stretch', flexWrap: 'wrap' },
  quickOption: { flex: 1, minWidth: 78, minHeight: 54, borderRadius: 12, justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1 },
});
