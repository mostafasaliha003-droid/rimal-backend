import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError, authSession } from '../api';
import { hotelId, validateSearchCriteria } from '../api/validation';
import { memberRateAccessDenied } from '../api/membership';
import { returnedSavedHotels } from '../components/savedHotelCards';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, elevation, layout, radius, space, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import HotelMapLink from '../components/HotelMapLink';
import StaysMap from '../components/StaysMap';
import { useChargeMoney } from '../components/ChargeCurrency';
import { useGuestRatings } from '../components/useGuestRatings';
import HotelCard from '../components/HotelCard';
import ApiState from '../components/ApiState';
import { Button, Card, Chip, Field, Icon, Notice, Row, Skeleton, StatePanel, Txt } from '../components/Primitives';
import { hotelSearchPlan } from '../components/foundationContracts';
import { activeResultFilters, beginResultRefresh, copyResultFilters, decideResults, emptyResultFilters,
  priceInCurrency, resultContextKey, stayNights, suggestedStayBudgets, type ResultFilters, type ResultSnapshot, type ResultSort } from '../components/resultsDecisionModel';
import { resultsCopy } from '../components/resultsCopy';
import { StaySummaryBar, useStayEditor } from '../components/StayFields';
import { formatPrice, stayLine } from '../components/format';
import { useLayout } from '../components/motion';

// Returning from a hotel within this window keeps the same list, order and scroll
// position instead of reshuffling prices mid-comparison. Older results refresh.
const FRESH_RESULTS_MS = 5 * 60_000;
const viewedHotels = new Set<number>(); // session memory only, never stored

/** The same footprint as a result card (photo, stars, name, address, badge and price). */
function ResultsSkeleton({ columns }: { columns: number }) {
  const { rtl } = useLanguage();
  return <View style={{ gap: space.md }}>
    {Array.from({ length: columns > 1 ? 6 : 4 }, (_, index) => <Card key={index} padded={false} style={{ flexDirection: rtl ? 'row-reverse' : 'row', overflow: 'hidden', minHeight: 150 }}>
      <Skeleton width={116} height={150} rounded={0}/>
      <View style={{ flex: 1, paddingHorizontal: space.md, paddingVertical: space.sm + 2, gap: space.sm, alignItems: rtl ? 'flex-end' : 'flex-start' }}>
        <Skeleton width="34%" height={12}/><Skeleton width="86%" height={18}/><Skeleton width="62%" height={12}/>
        <View style={{ flex: 1 }}/>
        <View style={{ flexDirection: rtl ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'flex-end', alignSelf: 'stretch' }}>
          <Skeleton width="36%" height={20} rounded={radius.sm}/><Skeleton width="38%" height={24}/>
        </View>
      </View>
    </Card>)}
  </View>;
}

export default function ResultsScreen({ savedOnly = false }: { savedOnly?: boolean }) {
  const { criteria, destinationName, saved, savedReady, savedErrorKind, retrySaved, comparisonItems, comparisonContextKey, getComparisonItems, clearComparison } = useAppState();
  const { t, language, rtl } = useLanguage(), L = resultsCopy(language), router = useRouter();
  const ar = language === 'ar';
  const { status: authStatus, sessionRevision } = useAuth();
  const { fontScale, size, gutter, desktop } = useLayout();
  const [variant, setVariant] = useState<'list' | 'photo'>('list');
  const columns = variant === 'photo' ? (size === 'compact' ? 1 : size === 'medium' ? 2 : 3) : (desktop && fontScale <= 1.3 ? 2 : 1);
  const [mapContext, setMapContext] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ResultSnapshot>({ context: '', hotels: [], pending: false, error: null });
  const refreshRevision = useRef(0);
  const [refresh, recheck] = useState(0), [paging, setPaging] = useState({ context: '', limit: 20 });
  const [appliedState, setAppliedState] = useState<{ context: string; value: ResultFilters }>({ context: '', value: emptyResultFilters() });
  const [draft, setDraft] = useState<ResultFilters>(emptyResultFilters), [sheetContext, setSheetContext] = useState<string | null>(null);
  const [sheetPane, setSheetPane] = useState<'filters' | 'sort'>('filters');
  const generation = useRef(0), inFlight = useRef<AbortController | null>(null), currentContext = useRef('');
  const lastFetch = useRef<{ context: string; at: number; refresh: number } | null>(null);
  const listRef = useRef<FlatList>(null);
  const scrollPosition = useRef<{ context: string; offset: number }>({ context: '', offset: 0 });
  const [, markViewed] = useState(0);
  const openedHotel = (hid: number) => { viewedHotels.add(hid); markViewed(value => value + 1); };
  const stayEditor = useStayEditor({ savedOnly });
  const [savedAtEntry, setSavedAtEntry] = useState(() => savedOnly ? saved.filter(id => hotelId(id) !== null) : null);
  const requestSavedIds = savedAtEntry, requestSavedReady = !savedOnly || savedReady;
  const candidate = useMemo(() => requestSavedReady ? hotelSearchPlan(criteria, language, requestSavedIds) : null,
    [criteria, language, requestSavedIds, requestSavedReady]);
  const plan = savedOnly && candidate && !validateSearchCriteria(candidate.criteria).valid ? null : candidate;
  const context = resultContextKey(plan?.key, language, authStatus, sessionRevision);
  const enabled = plan !== null && authStatus !== 'loading';
  const sameContext = enabled && snapshot.context === context;
  const hotels = useMemo(() => {
    if (!sameContext) return [];
    return savedOnly ? returnedSavedHotels(saved, snapshot.hotels) : snapshot.hotels;
  }, [sameContext, snapshot.hotels, savedOnly, saved]);
  const error = sameContext ? snapshot.error : null;
  const pending = enabled && (!sameContext || snapshot.pending);
  const refreshing = pending && hotels.length > 0;
  const defaults = useMemo(() => emptyResultFilters(), []);
  const applied = appliedState.context === context ? appliedState.value : defaults;
  const currency = criteria?.currency || '';
  const decision = useMemo(() => decideResults(hotels, applied, currency), [hotels, applied, currency]);
  const preview = useMemo(() => decideResults(hotels, draft, currency), [hotels, draft, currency]);
  const activeCount = activeResultFilters(applied), limit = paging.context === context ? paging.limit : 20;
  const sheet = sheetContext === context;
  const budgets = useMemo(() => sheet && sheetPane === 'filters'
    ? suggestedStayBudgets(hotels, draft.name, draft.stars, currency) : [],
  [sheet, sheetPane, hotels, draft.name, draft.stars, currency]);
  const setLimit = (value: number) => setPaging({ context, limit: value });
  const apply = (value: ResultFilters) => { setAppliedState({ context, value: copyResultFilters(value) }); setLimit(20); };
  const clearFilters = () => apply({ ...emptyResultFilters(), sort: applied.sort });
  const openSheet = (pane: 'filters' | 'sort') => {
    setDraft(copyResultFilters(applied));
    setSheetPane(pane);
    setSheetContext(context);
  };
  const openFilters = () => openSheet('filters');
  const refreshResults = () => { if (savedOnly) setSavedAtEntry(saved.filter(id => hotelId(id) !== null)); inFlight.current?.abort(); ++generation.current; setSnapshot(previous => beginResultRefresh(previous, context)); recheck(++refreshRevision.current); };
  useFocusEffect(useCallback(() => {
    currentContext.current = context;
    if (!plan || authStatus === 'loading') return;
    // Coming back from a hotel: restore the exact scroll position (browsers drop it for hidden screens).
    if (scrollPosition.current.context === context && scrollPosition.current.offset > 0) {
      const offset = scrollPosition.current.offset;
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset, animated: false }));
    }
    const previous = lastFetch.current;
    if (!savedOnly && previous && previous.context === context && previous.refresh === refresh && Date.now() - previous.at < FRESH_RESULTS_MS) return;
    const controller = new AbortController(), stamp = ++generation.current;
    inFlight.current = controller;
    if (savedOnly) setSnapshot({ context, hotels: [], pending: true, error: null });
    const current = () => refreshRevision.current === refresh && !controller.signal.aborted && stamp === generation.current && currentContext.current === context
      && authSession.getRevision() === sessionRevision && authSession.getSnapshot().status === authStatus;
    api.searchHotels(plan.criteria, controller.signal).then(hotels => {
      if (!current()) return;
      lastFetch.current = { context, at: Date.now(), refresh };
      setSnapshot({ context, hotels: requestSavedIds ? returnedSavedHotels(requestSavedIds, hotels) : hotels, pending: false, error: null });
    }).catch(error => {
      if (!current()) return;
      const denied = error instanceof ApiError && (error.kind === 'auth' || error.kind === 'membership');
      if (memberRateAccessDenied(error) && getComparisonItems(comparisonContextKey).length) clearComparison();
      setSnapshot(previous => ({ context, hotels: !savedOnly && !denied && previous.context === context ? previous.hotels : [], pending: false, error }));
    });
    return () => { controller.abort(); if (inFlight.current === controller) inFlight.current = null; };
  }, [plan, context, refresh, authStatus, sessionRevision, savedOnly, requestSavedIds, comparisonContextKey, getComparisonItems, clearComparison]));
  const edit = () => router.push(savedOnly ? '/saved-dates' : '/');
  const nights = stayNights(criteria);
  const mapLabel = ar ? 'الفنادق على الخريطة مع أسعارها' : 'Hotels on the map with their prices';
  // The map shows every listed hotel with coordinates, each pin carrying its stay total.
  const { height: windowHeight } = useWindowDimensions();
  const mapHeight = Math.max(260, Math.min(460, Math.round(windowHeight * 0.5)));
  const [mapSelected, setMapSelected] = useState<number | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const charge = useChargeMoney();
  const mapHotels = decision.hotels.filter(hotel => hotel.location).slice(0, 80);
  const mapPick = mapHotels.find(hotel => hotel.hid === mapSelected) ?? null;
  const mapMarkers = mapHotels.map(hotel => ({ id: hotel.hid, latitude: hotel.location!.latitude, longitude: hotel.location!.longitude, name: hotel.name,
    label: formatPrice(charge(priceInCurrency(hotel.price, currency))) || '•' }));
  const hasMap = decision.hotels.some(hotel => hotel.location);
  const title = savedOnly ? t('savedOfferTitle') : destinationName || t('results');
  // Guest ratings for the hotels shown (and the next few), fetched once per session.
  const ratingIds = useMemo(() => decision.hotels.slice(0, limit + 10).map(hotel => hotel.hid), [decision.hotels, limit]);
  const ratings = useGuestRatings(ratingIds, language);
  const sortName = (sort: ResultSort) => sort === 'stars' ? (ar ? 'الأعلى تصنيفاً' : 'Highest star rating') : t(sort);
  const sortLabel = applied.sort === 'recommended' ? t('sort') : sortName(applied.sort);
  const freeCancelLabel = ar ? 'إلغاء مجاني' : 'Free cancellation';
  const knowsCancellation = hotels.some(hotel => hotel.freeCancellation !== undefined);
  const count = hotels.length ? L.results(decision.hotels.length, hotels.length) : '';
  const stay = criteria ? stayLine(nights, criteria.guests, language) : '';

  // One-tap ways out of an empty filtered list, each keeping the dates and guests.
  const relaxations = (() => {
    if (!hotels.length || decision.hotels.length || !activeCount) return [];
    const options: { key: string; label: string; next: ResultFilters }[] = [];
    if (applied.name.trim()) options.push({ key: 'name', label: `${L.removeName}: ${applied.name.trim()}`, next: { ...applied, name: '' } });
    if (decision.budget.amount !== null) options.push({ key: 'budget', label: L.removeBudget, next: { ...applied, maxBudget: '' } });
    if (applied.freeCancel) options.push({ key: 'free-cancel', label: ar ? 'إزالة فلتر الإلغاء المجاني' : 'Remove free cancellation filter', next: { ...applied, freeCancel: false } });
    for (const star of applied.stars) options.push({ key: `star-${star}`, label: L.removeStar(star), next: { ...applied, stars: applied.stars.filter(value => value !== star) } });
    return options.map(option => ({ ...option, count: decideResults(hotels, option.next, currency).hotels.length }))
      .filter(option => option.count > 0).sort((a, b) => b.count - a.count);
  })();

  const header = <View style={{ gap: space.sm, paddingBottom: space.sm }}>
    {savedOnly && <Button compact variant="quiet" icon="back" title={t('saved')} onPress={() => router.dismissTo('/saved')}/>}
    {savedOnly && plan && sameContext && !pending && !error && hotels.length < saved.length &&
      <Txt kind="small">{ar ? `عادت نتائج لـ ${hotels.length} من ${saved.length} فنادق محفوظة.` : `Results returned for ${hotels.length} of ${saved.length} saved stays.`}</Txt>}
    <Row style={{ gap: space.sm, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
      <Row style={{ gap: space.sm, flexShrink: 1, flexWrap: 'wrap' }}>
        <Txt kind="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>{title}</Txt>
        {!!count && <Txt testID="results-count" kind="label" accessibilityLiveRegion="polite" style={styles.count}>{count}</Txt>}
      </Row>
      {criteria && <Button testID="results-summary" compact variant="quiet" icon="search" title={ar ? 'بحث جديد' : 'New search'}
        label={`${ar ? 'بحث جديد' : 'New search'} · ${title}`} onPress={edit}/>}
    </Row>
    {criteria && <StaySummaryBar compact testID="results-stay" criteria={criteria} onEditDates={() => stayEditor.editDates()} onEditGuests={stayEditor.editGuests}/>}
    {savedErrorKind && <Notice tone="danger" title={t(savedErrorKind === 'load' ? 'savedError' : 'savedSaveFailed')} action={{ label: t('retry'), onPress: () => void retrySaved() }}/>}
    {hotels.length > 0 && <>
      {/* Compact chips fit one line on a phone; wrapping (not a sideways scroller) keeps every tool visible in right-to-left layouts. */}
      <Row style={{ gap: space.xs, flexWrap: 'wrap' }}>
        <Chip size="sm" testID="results-filters" icon="filter" selected={activeCount > 0} label={`${t('filters')}${activeCount ? ` · ${activeCount}` : ''}`} onPress={openFilters}/>
        <Chip size="sm" testID="results-sort" icon="sort" selected={applied.sort !== 'recommended'} label={sortLabel} accessibilityLabel={`${t('sort')}: ${sortName(applied.sort)}`} onPress={() => openSheet('sort')}/>
        {hasMap && <Chip size="sm" icon="map" selected={mapContext === context} label={ar ? 'الخريطة' : 'Map'} accessibilityLabel={mapLabel}
          onPress={() => setMapContext(current => current === context ? null : context)}/>}
        <Chip size="sm" testID="results-density" icon={variant === 'list' ? 'image' : 'list'} label={variant === 'list' ? (ar ? 'الصور' : 'Photos') : (ar ? 'القائمة' : 'List')}
          accessibilityLabel={variant === 'list' ? (ar ? 'عرض النتائج بصور كبيرة' : 'Show results with large photos') : L.compactView}
          onPress={() => setVariant(value => value === 'list' ? 'photo' : 'list')}/>
      </Row>
      {activeCount > 0 && <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
        {applied.freeCancel && <Chip size="sm" label={freeCancelLabel} accessibilityLabel={ar ? 'إزالة فلتر الإلغاء المجاني' : 'Remove free cancellation filter'} onRemove={() => apply({ ...applied, freeCancel: false })}/>}
        {!!applied.name.trim() && <Chip size="sm" label={applied.name.trim()} accessibilityLabel={`${L.removeName}: ${applied.name}`} onRemove={() => apply({ ...applied, name: '' })}/>}
        {decision.budget.amount !== null && <Chip size="sm" label={L.budgetChip(decision.budget.amount, currency)} accessibilityLabel={L.removeBudget} onRemove={() => apply({ ...applied, maxBudget: '' })}/>}
        {applied.stars.map(star => <Chip size="sm" key={star} label={star ? `${star} ${t('stars')}` : L.unknownStars} accessibilityLabel={L.removeStar(star)} onRemove={() => apply({ ...applied, stars: applied.stars.filter(value => value !== star) })}/>)}
        <Button compact variant="quiet" title={L.clearAll} onPress={clearFilters}/>
      </Row>}
      {hasMap && mapContext === context && (mapFailed
        ? <Card padded={false} style={{ gap: 0, overflow: 'hidden' }}>{decision.hotels.filter(hotel => hotel.location).slice(0, limit).map((hotel, index) =>
          <View key={hotel.hid}>{index > 0 && <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: color.border }}/>}<HotelMapLink hotel={hotel} variant="row"/></View>)}</Card>
        : <View style={{ gap: space.sm }}>
          <StaysMap testID="results-map" label={mapLabel} height={mapHeight} markers={mapMarkers} selected={mapPick?.hid ?? null}
            onSelect={setMapSelected} onFailed={() => setMapFailed(true)}/>
          {mapPick ? <HotelCard hotel={mapPick} recentlyViewed={viewedHotels.has(mapPick.hid)} onOpen={openedHotel} comparisonDisabled={refreshing || Boolean(error)} rating={ratings.get(mapPick.hid)}/>
            : <Row style={{ gap: space.xs, justifyContent: 'center' }}><Icon name="pin" size={14} color={color.textSecondary}/>
              <Txt kind="caption">{ar ? 'اضغط على سعر في الخريطة لعرض الفندق' : 'Tap a price on the map to see the hotel'}</Txt></Row>}
        </View>)}
      {decision.unknownPriceCount > 0 && (decision.budget.amount !== null || applied.sort !== 'recommended') && <Txt kind="caption">{decision.budget.amount !== null ? L.budgetExcluded(decision.unknownPriceCount) : L.unknownPrice(decision.unknownPriceCount)}</Txt>}
      {refreshing && <Notice tone="info" live title={L.refreshing} body={L.oldPrices}/>}
      {!!error && <Notice tone="warning" live title={L.refreshFailed} action={{ label: L.refresh, onPress: refreshResults }}/>}
    </>}
  </View>;

  let content: React.ReactNode = null;
  if (savedOnly && !savedReady || authStatus === 'loading') content = <StatePanel title={t('loading')} busy/>;
  else if (savedOnly && saved.length === 0) content = <StatePanel icon="saved" title={t('savedEmpty')} body={t('savedBody')}/>;
  else if (!criteria || savedOnly && !plan) content = <View style={{ gap: space.md }}><StatePanel icon="calendar" title={t('datesRequired')} body={t('datesRequiredBody')}/><Button title={t('search')} onPress={edit}/></View>;
  else if (pending && !hotels.length) content = <View style={{ gap: space.md }}>
    <Txt testID="brand-wait-results" kind="subheading" accessibilityRole="progressbar" accessibilityLiveRegion="polite" aria-live="polite">
      {ar ? 'نبحث عن فنادق لتواريخك…' : 'Finding hotels for your dates…'}</Txt>
    <ResultsSkeleton columns={columns}/></View>;
  else if (!hotels.length && error instanceof ApiError && error.code === 'search_result_too_large') {
    content = <View style={{ gap: space.md }}><StatePanel icon="search" title={L.largeSearchTitle} body={L.largeSearchBody}/>
      <Button title={t('searchAgain')} onPress={edit}/></View>;
  }
  else if (error && !hotels.length) content = <ApiState error={error} retry={refreshResults}/>;
  else if (!decision.hotels.length) content = hotels.length ? <View testID="results-no-match" style={{ gap: space.md }}>
    <StatePanel icon="filter" title={L.noMatch} body={ar ? 'تواريخك وضيوفك كما هي. أزل فلتراً واحداً لرؤية إقامات مناسبة.' : 'Your dates and guests stay the same. Remove one filter to see matching stays.'}/>
    {relaxations.map(option => <Button key={option.key} testID={`results-relax-${option.key}`} variant="secondary" icon="close"
      title={`${option.label} · ${L.results(option.count, option.count)}`} onPress={() => apply(option.next)}/>)}
    <Button variant="quiet" title={L.clearAll} onPress={clearFilters}/>
  </View> : <View testID="results-empty" style={{ gap: space.md }}>
    <StatePanel icon="calendar" title={t('noResults')} body={ar ? 'لم تَرِد إقامات متاحة لهذه التواريخ. جرّب تواريخ أخرى أو وجهة قريبة؛ نحتفظ بعدد الضيوف.' : 'No stays were returned for these dates. Try other dates or a nearby destination; your guests are kept.'}/>
    {criteria && !savedOnly && <Button icon="calendar" title={ar ? 'غيّر التواريخ' : 'Change dates'} onPress={() => stayEditor.editDates()}/>}
    <Button variant="secondary" title={t('searchAgain')} onPress={edit}/>
  </View>;

  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    {/* Ratings arrive after the list; extraData lets the visible cards pick them up. */}
    <FlatList ref={listRef} key={`results-${columns}-${variant}`} numColumns={columns} extraData={ratings}
      columnWrapperStyle={columns > 1 ? { gap: space.md, flexDirection: rtl ? 'row-reverse' : 'row' } : undefined}
      data={content ? [] : decision.hotels.slice(0, limit)} keyExtractor={hotel => String(hotel.hid)}
      contentContainerStyle={[styles.list, { paddingHorizontal: gutter, maxWidth: desktop ? layout.maxContent : layout.maxReading + 160 }]}
      onScroll={event => { scrollPosition.current = { context, offset: event.nativeEvent.contentOffset.y }; }} scrollEventThrottle={64}
      renderItem={({ item }) => <View style={{ flex: 1 / columns, minWidth: 0 }}>
        <HotelCard hotel={item} variant={variant} recentlyViewed={viewedHotels.has(item.hid)} onOpen={openedHotel} comparisonDisabled={refreshing || Boolean(error)}
          rating={ratings.get(item.hid)}/></View>}
      ItemSeparatorComponent={() => <View style={{ height: space.sm + 2 }}/>} ListHeaderComponent={header} ListEmptyComponent={content || undefined}
      initialNumToRender={8} windowSize={9} removeClippedSubviews={Platform.OS === 'android'}
      ListFooterComponent={!content && decision.hotels.length > 0 ? <View style={{ paddingTop: space.lg, gap: space.md }}>
        {limit < decision.hotels.length && <Button variant="secondary" title={`${t('loadMore')} (${Math.min(20, decision.hotels.length - limit)})`} onPress={() => setLimit(limit + 20)}/>}
        <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
          <View style={{ paddingTop: 2 }}><Icon name="info" size={14} color={color.textSecondary}/></View>
          <Txt kind="caption" style={{ flex: 1 }}>{ar ? `الأسعار إجمالية لكامل الإقامة (${stay}) بعملة البحث. تظهر أي رسوم تُدفع في الفندق في تفاصيل كل عرض.`
            : `Prices are totals for the whole stay (${stay}). Any fees payable at the hotel are shown on each room offer.`}</Txt>
        </Row></View> : undefined}
      refreshing={refreshing} onRefresh={enabled ? refreshResults : undefined}/>
    {sameContext && !pending && !error && comparisonItems.length > 0 && <View style={[styles.dock, elevation.raised]}>
      <Row testID="results-comparison" style={[styles.dockInner, { maxWidth: desktop ? layout.maxContent : layout.maxReading + 160 }]}>
        <View style={{ flex: 1 }}><Txt kind="label">{L.compareTitle(comparisonItems.length)}</Txt>
          <Txt kind="caption" numberOfLines={2}>{comparisonItems.length === 1 ? L.compareNeedTwo : comparisonItems.map(item => item.name).join(' · ')}</Txt>
        </View><Button compact variant="quiet" title={t('clear')} label={L.clearCompare} onPress={clearComparison}/>
        {comparisonItems.length > 1 && <Button compact icon="compare" title={L.compare} label={`${L.compareCta(comparisonItems.length)}: ${comparisonItems.map(item => item.name).join(', ')}`} onPress={() => router.push('/compare')}/>}
      </Row></View>}
    <Modal visible={sheet} transparent animationType="slide" accessibilityLabel={sheetPane === 'sort' ? t('sort') : L.filtersTitle} onRequestClose={() => setSheetContext(null)}>
      <View style={[styles.scrim, desktop && { justifyContent: 'center' }]}>
        <Pressable accessible={false} onPress={() => setSheetContext(null)} style={StyleSheet.absoluteFill}/>
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal style={[styles.sheet, desktop && styles.dialog, elevation.overlay]}>
          {!desktop && <View style={styles.handle}/>}
          <Row style={styles.sheetHeader}>
            <Txt kind="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>{sheetPane === 'sort' ? t('sort') : L.filtersTitle}</Txt>
            <Button compact variant="quiet" title={L.cancel} onPress={() => setSheetContext(null)}/>
          </Row>
          {sheetPane === 'sort' ? <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ padding: space.lg }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('sort')} style={{ gap: space.sm }}>
              {(['recommended', 'lowPrice', 'highPrice', 'stars'] as ResultSort[]).map(sort => {
                const selected = applied.sort === sort;
                return <Pressable key={sort} accessibilityRole="radio" accessibilityLabel={sortName(sort)} aria-checked={selected} accessibilityState={{ checked: selected }}
                  onPress={() => {
                    if (currentContext.current !== sheetContext) return;
                    apply({ ...applied, sort });
                    setSheetContext(null);
                  }} style={({ pressed }) => [styles.sortOption, selected && styles.sortSelected, pressed && { backgroundColor: color.bgMuted }]}>
                  <Row style={{ justifyContent: 'space-between', gap: space.sm }}>
                    <Txt kind="label" style={{ flex: 1 }}>{sortName(sort)}</Txt>
                    <View style={[styles.radio, selected && styles.radioOn]}>{selected && <View style={styles.radioDot}/>}</View>
                  </Row>
                </Pressable>;
              })}
            </View>
          </ScrollView> : <>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
            {knowsCancellation && <View style={{ gap: space.xs }}>
              <Txt kind="label">{ar ? 'شروط الإلغاء' : 'Cancellation'}</Txt>
              <Row style={{ flexWrap: 'wrap', gap: space.sm }}>
                <Chip testID="results-free-cancel" role="checkbox" icon="checkCircle" selected={draft.freeCancel} label={`${freeCancelLabel} · ${preview.freeCancelCount}`}
                  accessibilityLabel={ar ? 'إلغاء مجاني متاح' : 'Free cancellation available'} onPress={() => setDraft(value => ({ ...value, freeCancel: !value.freeCancel }))}/>
              </Row>
            </View>}
            <Field label={L.name} placeholder={L.nameHint} value={draft.name} maxLength={120} autoCorrect={false} onChangeText={name => setDraft(value => ({ ...value, name }))}/>
            <View style={{ gap: space.sm }}>
              <Field label={`${L.budget} · ${currency}`} placeholder={L.budgetHint} value={draft.maxBudget} maxLength={30} keyboardType="decimal-pad" ltr
                hint={L.budgetHelp} error={preview.budget.valid ? undefined : L.budgetError} onChangeText={maxBudget => setDraft(value => ({ ...value, maxBudget }))}/>
              {budgets.length > 0 && <View style={{ gap: space.xs }}>
                <Txt kind="caption">{L.budgetChoices}</Txt>
                <Row style={{ gap: space.sm, flexWrap: 'wrap' }}>
                  {budgets.map(amount => <Chip key={amount} testID={`results-budget-${amount}`} selected={preview.budget.amount === amount}
                    label={`${amount} ${currency}`} accessibilityLabel={L.budgetChip(amount, currency)} onPress={() => setDraft(value => ({ ...value, maxBudget: amount }))}/>)}
                </Row>
              </View>}
            </View>
            <View style={{ gap: space.sm }}><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: space.xxs }}><Txt kind="label">{L.stars}</Txt>
              <Button compact variant="quiet" title={L.allStars} onPress={() => setDraft(value => ({ ...value, stars: [] }))}/></Row>
              <Row style={{ flexWrap: 'wrap', gap: space.sm }}>{[5, 4, 3, 2, 1, 0].map(star => {
                const selected = draft.stars.includes(star), starCount = preview.facetCounts[star];
                return <Chip key={star} role="checkbox" selected={selected} icon={star ? 'star' : undefined}
                  label={star ? L.starChoice(star, starCount) : L.unknownChoice(starCount)}
                  onPress={() => setDraft(value => ({ ...value, stars: selected ? value.stars.filter(item => item !== star) : [...value.stars, star] }))}/>;
              })}</Row>
            </View>
          </ScrollView>
          <Row style={styles.sheetFooter}>
            <Button compact variant="quiet" title={L.resetDraft} onPress={() => setDraft({ ...emptyResultFilters(), sort: applied.sort })}/>
            <View style={{ flexGrow: 1, flexBasis: 160 }} accessibilityLiveRegion="polite">
              <Button testID="results-apply" title={L.apply(preview.hotels.length)} disabled={!preview.budget.valid} onPress={() => {
                if (currentContext.current !== sheetContext || !preview.budget.valid) return;
                apply(draft); setSheetContext(null);
              }}/></View></Row></>}
        </SafeAreaView>
      </View>
    </Modal>
    {stayEditor.element}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  list: { width: '100%', alignSelf: 'center', paddingTop: space.md, paddingBottom: space.xxxl },
  count: { color: color.interactiveStrong, backgroundColor: color.bgSelected, borderRadius: radius.sm, paddingHorizontal: space.sm, overflow: 'hidden' },
  dock: { borderTopWidth: 1, borderColor: color.border, backgroundColor: color.bgSurface },
  dockInner: { width: '100%', alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm, justifyContent: 'space-between' },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.scrim },
  sheet: { maxHeight: '92%', width: '100%', maxWidth: layout.maxSheet, alignSelf: 'center', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, backgroundColor: color.bgSurface, direction: 'ltr' },
  dialog: { borderRadius: radius.xl, maxHeight: '86%' },
  handle: { alignSelf: 'center', marginTop: space.sm, width: 40, height: 4, borderRadius: 2, backgroundColor: color.border },
  sheetHeader: { paddingHorizontal: space.lg, paddingVertical: space.xs, justifyContent: 'space-between', borderBottomWidth: 1, borderColor: color.border },
  sheetFooter: { paddingHorizontal: space.lg, paddingVertical: space.sm, justifyContent: 'space-between', flexWrap: 'wrap', gap: space.sm, borderTopWidth: 1, borderColor: color.border },
  sortOption: { minHeight: 56, justifyContent: 'center', paddingHorizontal: space.lg, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: color.bgField },
  sortSelected: { borderColor: color.borderSelected, backgroundColor: color.bgSelected },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.borderControl, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: color.interactive },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.interactive },
});
