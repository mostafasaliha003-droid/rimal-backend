import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { api, APP_ENV, authSession, COUNTRY_CODES, validateSearchCriteria } from '../api';
import { useAuth } from '../auth';
import type { SearchCriteria, Suggestion } from '../types';
import { useLanguage } from '../i18n';
import { color, elevation, fonts, layout, localizedFont, radius, space, touch, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import { hotelId } from '../api/validation';
import DiscoveryShelves, { DestinationPicks, DiscoveryHero } from '../components/DiscoveryShelves';
import ApiState from '../components/ApiState';
import { Button, Card, Chip, Icon, Notice, Row, StatePanel, Txt } from '../components/Primitives';
import CalendarPicker from '../components/CalendarPicker';
import GuestPicker from '../components/GuestPicker';
import { copyGuestRooms, destinationFromSearch, destinationLookupName, quickStayDates, recentSearchDraft, resolveFeaturedCity,
  shouldSuggestDestination, stayNights, type DestinationId, type QuickStay } from '../components/searchJourneyModel';
import { searchCopy } from './searchCopy';
import CurrencyPicker from '../components/CurrencyPicker';
import { bookingCurrency, currencyName } from '../components/currencyCatalog';
import { useCurrencyPreference } from '../components/useCurrencyPreference';
import { DateFields, GuestsField } from '../components/StayFields';
import { ContinueSearchCard, UpcomingTripCard } from '../components/HomeCards';
import { resumeCriteria, resumeState } from '../components/lastSearchModel';
import { todayDate } from '../components/calendarModel';
import { formatDay, stayWords } from '../components/format';
import { useLayout } from '../components/motion';

type TravelDraft = Pick<SearchCriteria, 'checkin' | 'checkout' | 'guests' | 'residency'>;
const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

function initialTravel(criteria: SearchCriteria | null): TravelDraft {
  return {
    checkin: criteria?.checkin || '', checkout: criteria?.checkout || '',
    guests: copyGuestRooms(criteria?.guests || [{ adults: 2, children: [] }]),
    // A starting nationality for pricing. The guest confirms or changes it with the booking details.
    residency: criteria?.residency || 'ae',
  };
}

export default function SearchScreen({ savedOnly = false }: { savedOnly?: boolean }) {
  const { t, language, rtl } = useLanguage(); const router = useRouter(); const state = useAppState(); const copy = searchCopy(language);
  const { desktop, gutter } = useLayout();
  const [query, setQuery] = useState(state.destinationName); const [selected, select] = useState<Suggestion | null>(() => destinationFromSearch(state.criteria, state.destinationName));
  const [featuredCity, setFeaturedCity] = useState<DestinationId>('dubai');
  const [pickedCity, setPickedCity] = useState<DestinationId | null>(null);
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
  const destinationInput = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [destinationFocused, setDestinationFocused] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({}); const [submitted, setSubmitted] = useState(false);
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
  // "Book again" from Trips opens Explore with the hotel name: a fresh search, so prices
  // and availability are always rechecked for the new dates.
  const { q: bookAgain } = useLocalSearchParams<{ q?: string }>();
  const requestedHotel = !savedOnly && typeof bookAgain === 'string' && bookAgain.trim() ? bookAgain.trim().slice(0, 160) : null;
  const [appliedHotel, setAppliedHotel] = useState<string | null>(null);
  if (requestedHotel !== appliedHotel) {
    // Adjust form state while rendering when the parameter changes (no effect cascade).
    setAppliedHotel(requestedHotel);
    if (requestedHotel) {
      setPickedCity(null); setQuery(requestedHotel); select(null); setSubmitted(false);
      setDraft(previous => ({ source: state.criteria, value: { ...(previous.source === state.criteria ? previous.value : initialTravel(state.criteria)), checkin: '', checkout: '' } }));
    }
  }
  useEffect(() => {
    if (!requestedHotel) return;
    router.setParams({ q: undefined });
    requestAnimationFrame(() => { scroll.current?.scrollTo({ y: Math.max(0, formTop.current - 8), animated: false }); destinationInput.current?.focus(); });
  }, [requestedHotel, router]);
  const savedIds = state.saved.filter(id => hotelId(id) !== null);
  const submit = () => {
    if (!preference.ready) return;
    const destination = selected?.name === query ? selected : !pickedCity && query === state.destinationName ? destinationFromSearch(state.criteria, query) : null;
    // RateHawk prices each rate for the guest's nationality. Until the guest states it at checkout, the first
    // search prices for the traveller's own country (network or device region) instead of a fixed one, so
    // most guests confirm the same nationality at checkout and no second price check is needed. Once a
    // nationality is chosen it stays on the search for the rest of the session.
    const detected = preference.country?.toLowerCase();
    const searchResidency = !state.criteria && residency === 'ae' && detected && COUNTRY_CODES.includes(detected) ? detected : residency;
    const criteria: SearchCriteria = { checkin, checkout, guests: copyGuestRooms(guests), residency: searchResidency, currency, language, ...(savedOnly ? { hids: savedIds } : destination?.regionId ? { regionId: destination.regionId } : destination?.hid ? { hids: [destination.hid] } : {}) };
    const validation = validateSearchCriteria(criteria); const next = { destination: savedOnly ? !savedIds.length : !destination || !query.trim(), dates: validation.errors.includes('invalid_checkin') || validation.errors.includes('invalid_checkout'), residency: !COUNTRY_CODES.includes(searchResidency), guests: validation.errors.includes('invalid_guests') };
    setErrors(next); setSubmitted(true);
    if (!validation.valid || Object.values(next).some(Boolean)) {
      if (next.destination) destinationInput.current?.focus();
      return;
    }
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
  const fillForm = (value: { query: string; selected: Suggestion; checkin: string; checkout: string; guests: SearchCriteria['guests']; residency: string }) => {
    setPickedCity(null); setQuery(value.query); select(value.selected);
    updateTravel({ checkin: value.checkin, checkout: value.checkout, guests: value.guests, residency: value.residency });
    setErrors({}); setSubmitted(false); setSuggestionResult({ key: '', values: [], error: null }); Keyboard.dismiss();
  };
  const restoreRecent = (id: string) => {
    // Re-resolve ownership at press time: an old session's rendered handler
    // must not restore a record after logout or same-account reauthentication.
    const recent = state.getRecentSearches().find(value => value.id === id);
    if (!recent) return;
    const restored = recentSearchDraft(recent); if (!restored) return;
    fillForm(restored); returnToForm();
  };
  const chooseQuickStay = (kind: QuickStay) => {
    const dates = quickStayDates(kind); updateTravel(dates);
    setErrors(current => ({ ...current, dates: false }));
  };
  const nights = stayNights(checkin, checkout);
  const chooseDestination = (id: DestinationId, name: string) => {
    setFeaturedCity(id); setPickedCity(id); setQuery(name); select(null); setSubmitted(false);
    setErrors(previous => ({ ...previous, destination: false }));
    returnToForm();
  };

  // Continue where the traveler stopped: this session's search first, otherwise the device's last search.
  const today = todayDate();
  const currentSearch = state.criteria && state.destinationName && (state.criteria.regionId || state.criteria.hids?.length === 1)
    ? { name: state.destinationName, criteria: state.criteria, current: true } : null;
  const storedSearch = state.lastSearch ? { name: state.lastSearch.name, criteria: state.lastSearch.criteria, current: false } : null;
  const continueSource = savedOnly ? null : currentSearch ?? storedSearch;
  const continueCard = continueSource && <ContinueSearchCard name={continueSource.name} criteria={continueSource.criteria} current={continueSource.current}
    datesPassed={continueSource.criteria.checkin < today}
    onResume={() => {
      if (continueSource.current) { router.push('/results'); return; }
      if (!state.lastSearch || !preference.ready || resumeState(state.lastSearch, today) !== 'ready') return;
      state.setSearch(resumeCriteria(state.lastSearch, currency, language), state.lastSearch.name);
      router.push('/results');
    }}
    onEdit={() => {
      const restored = destinationFromSearch(continueSource.criteria, continueSource.name);
      if (!restored) return;
      fillForm({ query: continueSource.name, selected: restored, checkin: continueSource.criteria.checkin, checkout: continueSource.criteria.checkout,
        guests: copyGuestRooms(continueSource.criteria.guests), residency: continueSource.criteria.residency });
      returnToForm();
    }}
    onNewDates={() => {
      const restored = destinationFromSearch(continueSource.criteria, continueSource.name);
      if (!restored) return;
      fillForm({ query: continueSource.name, selected: restored, checkin: '', checkout: '', guests: copyGuestRooms(continueSource.criteria.guests), residency: continueSource.criteria.residency });
      setCalendar({ field: 'checkin', source: state.criteria });
    }}
    onClear={continueSource.current ? undefined : state.clearLastSearch}/>;
  const otherRecent = state.recentSearches.filter(recent => !continueSource?.current || recent.name !== state.destinationName
    || recent.criteria.checkin !== state.criteria?.checkin || recent.criteria.checkout !== state.criteria?.checkout).slice(0, 3);

  if (savedOnly && (!state.savedReady || !savedIds.length)) {
    return <SafeAreaView edges={['top','bottom']} style={ui.screen}><BrandHeader back/>
      <View style={ui.page}><StatePanel title={t(state.savedLoading ? 'loading' : state.savedError ? 'savedError' : 'saved')}
        busy={state.savedLoading}/><Button title={t('saved')} onPress={() => router.dismissTo('/saved')}/></View>
    </SafeAreaView>;
  }

  const destinationError = errors.destination;
  const form = <Card testID="search-form" elevated onLayout={event => { formTop.current = event.nativeEvent.layout.y; }} style={[styles.form, desktop && elevation.raised]}>
    {savedOnly ? <Txt kind="heading" accessibilityRole="header">{t('savedDatesTitle')}</Txt>
      : continueSource && !continueSource.current && <Txt kind="label" accessibilityRole="header">{rtl ? 'أو ابدأ بحثاً جديداً' : 'Or start a new search'}</Txt>}
    {!savedOnly && <View style={{ gap: space.xs }}>
      <Pressable accessible={false} focusable={false} tabIndex={-1} onPress={() => destinationInput.current?.focus()}
        style={[styles.destinationRow, { flexDirection: rtl ? 'row-reverse' : 'row', borderColor: destinationError ? color.danger : destinationFocused ? color.interactive : color.borderControl },
          destinationFocused && { borderWidth: 2 }]}>
        <Icon name="pin" size={20} color={color.interactiveStrong}/>
        <View style={{ flex: 1 }}>
          <Txt kind="caption" style={{ lineHeight: 18 }}>{rtl ? 'الوجهة' : 'Destination'}</Txt>
          <TextInput ref={destinationInput} testID="search-destination" accessibilityLabel={t('destination')} accessibilityHint={destinationError ? t('pickDestination') : undefined}
            onFocus={() => setDestinationFocused(true)} onBlur={() => setDestinationFocused(false)}
            value={query} onChangeText={value => { setPickedCity(null); setQuery(value); select(null); setSubmitted(false); setErrors(current => ({ ...current, destination: false })); }}
            placeholder={t('destinationHint')} placeholderTextColor={color.textSecondary} autoCorrect={false} returnKeyType="search"
            style={[styles.destination, { fontFamily: localizedFont(language, fonts.bold), textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' },
              Platform.OS === 'web' && ({ outlineStyle: 'none' } as object)]}/>
        </View>
        {selected?.name === query && !!query && <Icon name="checkCircle" size={20} color={color.success}/>}
      </Pressable>
      {destinationError && <Row style={{ gap: space.xs }}><Icon name="alertCircle" size={16} color={color.danger}/>
        <Txt kind="small" accessibilityRole="alert" style={{ color: color.danger, flex: 1 }}>{t('pickDestination')}</Txt></Row>}
      {suggesting && <Txt kind="small" accessibilityLiveRegion="polite">{t('loading')}</Txt>}
      {!suggesting && needsSuggestions && (suggestError ? <ApiState error={suggestError} retry={() => retrySuggestion(value => value + 1)} />
        : suggestions.length === 0 ? <Txt kind="small">{t('noSuggestions')}</Txt>
          : <View style={styles.suggestions} accessibilityRole="list">{suggestions.map(item => <Pressable key={item.id} accessibilityRole="button"
            accessibilityLabel={`${item.name}${item.subtitle ? `, ${item.subtitle}` : ''}`}
            onPress={() => { select(item); setQuery(item.name); setErrors(current => ({ ...current, destination: false })); Keyboard.dismiss(); }}
            style={state => [styles.suggestion, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}>
            <Row><View style={styles.suggestionIcon}><Icon name={item.type === 'region' ? 'pin' : 'hotel'} color={color.interactiveStrong} size={18}/></View>
              <View style={{ flex: 1 }}><Txt kind="label">{item.name}</Txt>{item.subtitle && <Txt kind="caption">{item.subtitle}</Txt>}</View>
              <Icon name="chevron" size={16} color={color.textSecondary}/></Row></Pressable>)}</View>)}
    </View>}
    <DateFields checkin={checkin} checkout={checkout} error={errors.dates} onOpen={field => { Keyboard.dismiss(); setCalendar({ field, source: state.criteria }); }}/>
    {errors.dates && <Row style={{ gap: space.xs }}><Icon name="alertCircle" size={16} color={color.danger}/>
      <Txt accessibilityRole="alert" kind="small" style={{ color: color.danger, flex: 1 }}>{t('datesError')}</Txt></Row>}
    <Row style={styles.quickRow} accessibilityLabel={rtl ? 'تواريخ سريعة' : 'Quick dates'}>
      {(['tonight', 'tomorrow', 'nextWeek'] as const).map(kind => {
        const dates = quickStayDates(kind); const chosen = dates.checkin === checkin && dates.checkout === checkout;
        return <Chip size="sm" key={kind} testID={'quick-stay-' + kind} selected={chosen} accessibilityLabel={copy[kind]}
          label={({ tonight: rtl ? 'الليلة' : 'Tonight', tomorrow: rtl ? 'غداً' : 'Tomorrow', nextWeek: rtl ? 'بعد 7 أيام' : 'In 7 days' })[kind]}
          onPress={() => chooseQuickStay(kind)}/>;
      })}
    </Row>
    <GuestsField guests={guests} error={submitted && errors.guests} onOpen={() => { Keyboard.dismiss(); setGuestEditor({ source: state.criteria }); }}/>
    {submitted && (errors.residency || errors.guests) && <Row style={{ gap: space.xs }}><Icon name="alertCircle" size={16} color={color.danger}/>
      <Txt accessibilityRole="alert" kind="small" style={{ color: color.danger, flex: 1 }}>{t(errors.residency ? 'residencyError' : 'guestsError')}</Txt></Row>}
    <Pressable testID="search-currency" accessibilityRole="button"
      onPress={() => showCurrency(true)} style={state => [styles.currencyControl, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}>
      <Row style={{ gap: space.sm }}><Icon name="wallet" size={16} color={color.textSecondary}/>
        <Txt kind="small" numberOfLines={1} accessibilityLabel={`${rtl ? 'عملة الدفع' : 'Payment currency'}: ${currencyName(preference.currency, language)} (${preference.currency}) · ${currencySource}`} style={{ flex: 1 }}>
          {rtl ? 'الدفع بـ' : 'Pay in'} <Txt kind="label">{currencyName(preference.currency, language)} ({preference.currency})</Txt></Txt>
        <Txt kind="caption" tone="link">{rtl ? 'تغيير' : 'Change'}</Txt></Row>
    </Pressable>
    {preference.saveFailed && <Txt kind="small" accessibilityRole="alert">{rtl ? 'تعذّر حفظ العملة على الجهاز. ينطبق اختيارك على هذه الجلسة.' : 'Could not save your currency on this device. It applies for this session.'}</Txt>}
    <View testID="search-submit">
      <Button size="lg" icon={savedOnly ? 'check' : 'search'} disabled={!preference.ready} onPress={submit}
        hint={nights !== null ? copy.nights(nights) : undefined}
        title={savedOnly ? t('applyStayDates') : nights !== null ? (rtl ? `ابحث · ${stayWords(language).nights(nights)}` : `Search · ${stayWords(language).nights(nights)}`) : (rtl ? 'ابحث عن فنادق' : 'Search hotels')}/>
    </View>
  </Card>;

  const recentList = !savedOnly && otherRecent.length > 0 && <View style={{ gap: space.sm }}>
    <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: space.xs }}>
      <Txt kind="subheading" accessibilityRole="header">{rtl ? 'عمليات بحث سابقة' : 'Recent searches'}</Txt>
      <Button compact variant="quiet" title={t('clear')} label={copy.clearRecent} onPress={state.clearRecentSearches}/>
    </Row>
    <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
      {otherRecent.map(recent => <Chip key={recent.id} testID="restore-recent-search" icon="history" accessibilityLabel={`${recent.name}, ${copy.recentHint}`}
        label={`${recent.name} · ${formatDay(recent.criteria.checkin, language)}`} onPress={() => restoreRecent(recent.id)}/>)}
    </Row>
  </View>;

  const membership = !savedOnly && <Pressable accessibilityRole="button" testID="home-membership" onPress={() => router.push('/membership')}
    style={state => [styles.membership, (state.pressed || hovered(state)) && { backgroundColor: '#EEE4FC' }]}>
    <Row style={{ gap: space.md }}>
      <View style={styles.membershipIcon}><Icon name="sparkles" size={20} color={color.interactiveStrong}/></View>
      <View style={{ flex: 1, gap: space.xxs }}>
        <Txt kind="label">{rtl ? 'العضوية وأسعار الأعضاء' : 'Membership and member rates'}</Txt>
        <Txt kind="caption">{rtl ? 'تعرّف على شروط الانضمام وحالة طلبك.' : 'See who can join and the status of your application.'}</Txt>
      </View>
      <Icon name="chevron" size={18} color={color.interactiveStrong}/>
    </Row>
  </Pressable>;


  return <SafeAreaView edges={savedOnly ? ['top','bottom'] : ['top']} style={ui.screen}><BrandHeader back={savedOnly} />
    <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'} contentContainerStyle={{ paddingBottom: space.xxl }}>
      <View style={[styles.page, { paddingHorizontal: gutter, maxWidth: desktop ? layout.maxContent : layout.maxReading }]}>
        {!savedOnly && <UpcomingTripCard/>}
        {desktop && !savedOnly ? <>
          <Row style={{ alignItems: 'stretch', gap: space.xl }}>
            <View style={{ width: 460, gap: space.lg }}>
              <View style={{ gap: space.xs }}><Txt kind="display" accessibilityRole="header">{rtl ? 'إلى أين وجهتك القادمة؟' : 'Where to next?'}</Txt>
                <Txt kind="body" tone="secondary">{rtl ? 'أسعار إجمالية لكامل الإقامة وشروط واضحة قبل أن تحجز.' : 'Full-stay prices and clear terms before you book.'}</Txt></View>
              {continueCard}
              {form}
            </View>
            <View style={{ flex: 1, gap: space.lg }}>
              <DiscoveryHero cityId={featuredCity} preview={setFeaturedCity} choose={chooseDestination}/>
              {recentList}
              {membership}
            </View>
          </Row>
          <DestinationPicks choose={chooseDestination}/>
          <DiscoveryShelves/>
        </> : <>
          {!savedOnly && <View style={{ gap: 0 }}>
            <Txt kind="heading" accessibilityRole="header" style={{ fontSize: 22, lineHeight: rtl ? 34 : 30 }}>{rtl ? 'إلى أين وجهتك القادمة؟' : 'Where to next?'}</Txt>
            <Txt kind="caption">{rtl ? 'أسعار إجمالية لكامل الإقامة وشروط واضحة قبل أن تحجز.' : 'Full-stay prices and clear terms before you book.'}</Txt>
          </View>}
          {continueCard}
          {form}
          {recentList}
          {!savedOnly && <DestinationPicks choose={chooseDestination}/>}
          {!savedOnly && <DiscoveryShelves/>}
          {membership}
        </>}
        {submitted && Object.values(errors).some(Boolean) && Platform.OS === 'web' && <Notice tone="danger" live title={rtl ? 'راجع الحقول المظللة' : 'Check the highlighted fields'}/>}
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
    <CurrencyPicker visible={currencyOpen} value={preference.currency} automatic={preference.source !== 'manual'}
      onClose={() => showCurrency(false)} onChange={preference.choose} onAutomatic={preference.useAutomatic}/>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { width: '100%', alignSelf: 'center', paddingTop: space.md, gap: space.md },
  form: { gap: space.sm + 2, padding: space.md, borderRadius: radius.lg },
  destinationRow: { alignItems: 'center', gap: space.sm + 2, minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.md, borderWidth: 1, backgroundColor: color.bgSurface },
  destination: { color: color.textPrimary, minHeight: 28, fontSize: 17, lineHeight: 24, paddingHorizontal: 0, paddingVertical: 0 },
  suggestions: { borderWidth: 1, borderColor: color.border, borderRadius: radius.md, overflow: 'hidden', backgroundColor: color.bgSurface },
  suggestion: { minHeight: 56, paddingHorizontal: space.md, paddingVertical: space.sm, justifyContent: 'center', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.border },
  suggestionIcon: { width: 36, height: 36, borderRadius: radius.pill, backgroundColor: color.bgSelected, alignItems: 'center', justifyContent: 'center' },
  quickRow: { gap: space.xs, flexWrap: 'wrap' },
  currencyControl: { minHeight: touch.min - 4, paddingHorizontal: space.xs, justifyContent: 'center', borderRadius: radius.sm },
  membership: { minHeight: 56, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: color.bgSelected },
  membershipIcon: { width: 40, height: 40, borderRadius: radius.pill, backgroundColor: color.bgSurface, alignItems: 'center', justifyContent: 'center' },
});
