import React, { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { api, ApiError, authSession } from '../api';
import { hotelId, validateSearchCriteria } from '../api/validation';
import { memberRateAccessDenied } from '../api/membership';
import { returnedSavedHotels } from '../components/savedHotelCards';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import HotelMapLink from '../components/HotelMapLink';
import HotelCard from '../components/HotelCard';
import ApiState from '../components/ApiState';
import { Button, Field, Icon, Row, StatePanel, Txt } from '../components/Primitives';
import { displayTravelDate } from '../components/searchJourneyModel';
import { hotelSearchPlan } from '../components/foundationContracts';
import { activeResultFilters, beginResultRefresh, copyResultFilters, decideResults, emptyResultFilters,
  resultContextKey, stayNights, type ResultFilters, type ResultSnapshot, type ResultSort } from '../components/resultsDecisionModel';
import { resultsCopy } from '../components/resultsCopy';

function FilterChip({ text, label, clear }: { text: string; label: string; clear: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`${text}: ${label}`} onPress={clear}
    style={{ minHeight: 48, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 13, paddingVertical: 9, borderRadius: 14, backgroundColor: colors.softBlue, borderWidth: 1, borderColor: colors.border }}>
    <Txt kind="small" style={{ color: colors.blueStrong }}>{text} ×</Txt>
  </Pressable>;
}

export default function ResultsScreen({ savedOnly = false }: { savedOnly?: boolean }) {
  const { criteria, destinationName, saved, savedReady, savedErrorKind, retrySaved, comparisonItems, comparisonContextKey, getComparisonItems, clearComparison } = useAppState();
  const { t, language, rtl } = useLanguage(), L = resultsCopy(language), router = useRouter();
  const { status: authStatus, sessionRevision } = useAuth();
  const { width, fontScale } = useWindowDimensions();
  const columns = width >= 760 && fontScale <= 1.3 ? 2 : 1;
  const [mapContext, setMapContext] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ResultSnapshot>({ context: '', hotels: [], pending: false, error: null });
  const refreshRevision = useRef(0);
  const [refresh, recheck] = useState(0), [paging, setPaging] = useState({ context: '', limit: 20 });
  const [appliedState, setAppliedState] = useState<{ context: string; value: ResultFilters }>({ context: '', value: emptyResultFilters() });
  const [draft, setDraft] = useState<ResultFilters>(emptyResultFilters), [sheetContext, setSheetContext] = useState<string | null>(null);
  const [sheetPane, setSheetPane] = useState<'filters' | 'sort'>('filters');
  const generation = useRef(0), inFlight = useRef<AbortController | null>(null), currentContext = useRef('');
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
  const decision = useMemo(() => decideResults(hotels, applied, criteria?.currency || ''), [hotels, applied, criteria?.currency]);
  const preview = useMemo(() => decideResults(hotels, draft, criteria?.currency || ''), [hotels, draft, criteria?.currency]);
  const activeCount = activeResultFilters(applied), limit = paging.context === context ? paging.limit : 20;
  const sheet = sheetContext === context;
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
    const controller = new AbortController(), stamp = ++generation.current;
    inFlight.current = controller;
    if (savedOnly) setSnapshot({ context, hotels: [], pending: true, error: null });
    const current = () => refreshRevision.current === refresh && !controller.signal.aborted && stamp === generation.current && currentContext.current === context
      && authSession.getRevision() === sessionRevision && authSession.getSnapshot().status === authStatus;
    api.searchHotels(plan.criteria, controller.signal).then(hotels => {
      if (current()) setSnapshot({ context, hotels: requestSavedIds ? returnedSavedHotels(requestSavedIds, hotels) : hotels, pending: false, error: null });
    }).catch(error => {
      if (!current()) return;
      const denied = error instanceof ApiError && (error.kind === 'auth' || error.kind === 'membership');
      if (memberRateAccessDenied(error) && getComparisonItems(comparisonContextKey).length) clearComparison();
      setSnapshot(previous => ({ context, hotels: !savedOnly && !denied && previous.context === context ? previous.hotels : [], pending: false, error }));
    });
    return () => { controller.abort(); if (inFlight.current === controller) inFlight.current = null; };
  }, [plan, context, refresh, authStatus, sessionRevision, savedOnly, requestSavedIds, comparisonContextKey, getComparisonItems, clearComparison]));
  const edit = () => router.push(savedOnly ? '/saved-dates' : '/');
  const nights = stayNights(criteria), roomCount = criteria?.guests.length || 0;
  const mapLabel = rtl ? 'مواقع الفنادق على الخريطة' : 'Hotel locations on the map';
  const filtersLabel = `${t('filters')}${activeCount ? ` · ${activeCount}` : ''}`;
  const hasMap = decision.hotels.some(hotel => hotel.location);
  const title = savedOnly ? t('savedOfferTitle') : destinationName || t('results');
  const sortLabel = applied.sort === 'recommended' ? t('sort') : t(applied.sort);
  const header = <View style={{ gap: 11 }}>
    {savedOnly && <Button compact variant="quiet" title={t('saved')} onPress={() => router.dismissTo('/saved')}/>}
    {savedOnly && plan && sameContext && !pending && !error && hotels.length < saved.length &&
      <Txt kind="small">{language === 'ar' ? `عادت نتائج لـ ${hotels.length} من ${saved.length} فنادق محفوظة.` : `Results returned for ${hotels.length} of ${saved.length} saved stays.`}</Txt>}
    {criteria ? <Pressable testID="results-summary" accessibilityRole="button" accessibilityLabel={t('searchAgain')}
      accessibilityHint={`${title}, ${criteria.checkin}, ${criteria.checkout}, ${nights !== null ? L.stayContext(nights, roomCount) : ''}`}
      onPress={edit} style={({ pressed }) => [styles.summary, pressed && styles.pressed]}>
      <Row style={{ gap: 12, alignItems: 'center' }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt kind="title" style={styles.destination} accessibilityRole="header">{title}</Txt>
          <Txt kind="small" style={{ color: colors.softBlue }}>{displayTravelDate(criteria.checkin, language)} – {displayTravelDate(criteria.checkout, language)} · {L.guests(criteria.guests.reduce((sum, room) => sum + room.adults + room.children.length, 0))}</Txt>
        </View><Row style={styles.edit}><Icon name="search" color={colors.primary} size={16}/><Txt kind="label">{rtl ? 'تعديل' : 'Edit'}</Txt></Row>
      </Row>
    </Pressable> : <Txt kind="title" accessibilityRole="header">{title}</Txt>}
    {savedErrorKind && <View><Txt accessibilityRole="alert" style={{ color: colors.red }}>{t(savedErrorKind === 'load' ? 'savedError' : 'savedSaveFailed')}</Txt>
      <Button compact variant="quiet" title={t('retry')} onPress={() => void retrySaved()}/></View>}
    {hotels.length > 0 && <>
      <Row style={{ gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
        <Pressable testID="results-filters" accessibilityRole="button" accessibilityLabel={filtersLabel} onPress={openFilters}
          style={({ pressed }) => [styles.tool, activeCount > 0 && styles.activeTool, pressed && styles.pressed]}>
          <Row style={styles.toolContents}><Icon name="filter" size={18}/><Txt kind="label">{filtersLabel}</Txt></Row>
        </Pressable>
        <Pressable testID="results-sort" accessibilityRole="button" accessibilityLabel={`${t('sort')}: ${t(applied.sort)}`} onPress={() => openSheet('sort')}
          style={({ pressed }) => [styles.tool, applied.sort !== 'recommended' && styles.activeTool, pressed && styles.pressed]}>
          <Row style={styles.toolContents}><Txt accessibilityElementsHidden importantForAccessibility="no" style={styles.sortIcon}>↕</Txt><Txt kind="label">{sortLabel}</Txt></Row>
        </Pressable>
        {hasMap && <Pressable accessibilityRole="button" accessibilityLabel={mapLabel} accessibilityState={{ expanded: mapContext === context }}
          onPress={() => setMapContext(current => current === context ? null : context)}
          style={({ pressed }) => [styles.tool, mapContext === context && styles.activeTool, pressed && styles.pressed]}>
          <Row style={{ gap: 6, justifyContent: 'center' }}><Icon name="map" size={17}/><Txt kind="label">{rtl ? 'الخريطة' : 'Map'}</Txt></Row>
        </Pressable>}
      </Row>
      {hasMap && mapContext === context && decision.hotels.filter(hotel => hotel.location).slice(0, limit).map(hotel =>
        <HotelMapLink key={hotel.hid} hotel={hotel} showName/>)}
      <View style={{ gap: 2 }}>
        <Txt kind="heading" accessibilityRole="header" accessibilityLiveRegion="polite">{L.results(decision.hotels.length, hotels.length)}</Txt>
        {decision.hotels.length > 0 && <Txt kind="small" style={styles.note}>{L.taxesNote}</Txt>}
      </View>
      {activeCount > 0 && <Row style={{ flexWrap: 'wrap' }}>
        {!!applied.name.trim() && <FilterChip text={applied.name.trim()} label={`${L.removeName}: ${applied.name}`} clear={() => apply({ ...applied, name: '' })}/>}
        {decision.budget.amount !== null && <FilterChip text={L.budgetChip(decision.budget.amount, criteria?.currency || '')} label={L.removeBudget} clear={() => apply({ ...applied, maxBudget: '' })}/>}
        {applied.stars.map(star => <FilterChip key={star} text={star ? `${star} ${t('stars')}` : L.unknownStars} label={L.removeStar(star)} clear={() => apply({ ...applied, stars: applied.stars.filter(value => value !== star) })}/>)}
        <Button compact variant="quiet" title={L.clearAll} onPress={clearFilters}/>
      </Row>}
      {decision.unknownPriceCount > 0 && (decision.budget.amount !== null || applied.sort !== 'recommended') && <Txt kind="small">{decision.budget.amount !== null ? L.budgetExcluded(decision.unknownPriceCount) : L.unknownPrice(decision.unknownPriceCount)}</Txt>}
      {refreshing && <View accessibilityLiveRegion="polite"><Txt kind="label">{L.refreshing}</Txt><Txt kind="small">{L.oldPrices}</Txt></View>}
      {!!error && <View style={[ui.card, { backgroundColor: colors.softGold }]}><Txt accessibilityRole="alert">{L.refreshFailed}</Txt><Button compact variant="secondary" title={L.refresh} onPress={refreshResults}/></View>}
    </>}
  </View>;
  let content: React.ReactNode = null;
  if (savedOnly && !savedReady || authStatus === 'loading') content = <StatePanel title={t('loading')} busy/>;
  else if (savedOnly && saved.length === 0) content = <StatePanel title={t('savedEmpty')} body={t('savedBody')}/>;
  else if (!criteria || savedOnly && !plan) content = <View style={{ gap: 14 }}><StatePanel title={t('datesRequired')} body={t('datesRequiredBody')}/><Button title={t('search')} onPress={edit}/></View>;
  else if (pending && !hotels.length) content = <View style={styles.loading} accessible accessibilityRole="progressbar" accessibilityState={{ busy: true }}
    accessibilityLabel={`${L.checkingAvailability}. ${L.checkingAvailabilityBody}`} accessibilityLiveRegion="polite">
    <Row style={{ gap: 13 }}><ActivityIndicator color={colors.grape}/><View style={{ flex: 1, gap: 2 }}>
      <Txt kind="heading">{L.checkingAvailability}</Txt><Txt kind="small">{L.checkingAvailabilityBody}</Txt>
    </View></Row>
  </View>;
  else if (!hotels.length && error instanceof ApiError && error.code === 'search_result_too_large') {
    content = <View style={{ gap: 14 }}><StatePanel title={L.largeSearchTitle} body={L.largeSearchBody}/>
      <Button title={t('searchAgain')} onPress={edit}/></View>;
  }
  else if (error && !hotels.length) content = <ApiState error={error} retry={refreshResults}/>;
  else if (!decision.hotels.length) content = <View style={{ gap: 14 }}><StatePanel title={hotels.length ? L.noMatch : t('noResults')} body={hotels.length ? L.noMatchBody : t(savedOnly ? 'savedNoAvailability' : 'noResultsBody')}/>{hotels.length > 0 && <><Button title={L.clearAll} variant="secondary" onPress={clearFilters}/><Button title={t('filters')} variant="quiet" onPress={openFilters}/></>}<Button title={t('searchAgain')} variant="quiet" onPress={edit}/></View>;
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <FlatList key={`results-${columns}`} numColumns={columns} columnWrapperStyle={columns === 2 ? { justifyContent: 'space-between', flexDirection: rtl ? 'row-reverse' : 'row' } : undefined}
      data={content ? [] : decision.hotels.slice(0, limit)} keyExtractor={hotel => String(hotel.hid)} contentContainerStyle={[ui.page, { gap: 0 }]}
      renderItem={({ item }) => <View style={{ width: columns === 2 ? '49%' : '100%' }}><HotelCard hotel={item} comparisonDisabled={refreshing || Boolean(error)}/></View>}
      ItemSeparatorComponent={() => <View style={{ height: 17 }}/>} ListHeaderComponent={<View style={{ paddingBottom: 13 }}>{header}</View>} ListEmptyComponent={content || undefined}
      ListFooterComponent={!content && limit < decision.hotels.length ? <View style={{ paddingTop: 18 }}><Button variant="secondary" title={`${t('loadMore')} (${Math.min(20, decision.hotels.length - limit)})`} onPress={() => setLimit(limit + 20)}/></View> : undefined}
      refreshing={refreshing} onRefresh={enabled ? refreshResults : undefined}/>
    {sameContext && !pending && !error && comparisonItems.length > 0 && <View style={{ borderTopWidth: 1, borderColor: colors.border, backgroundColor: colors.surface }}>
      <View testID="results-comparison" style={{ width: '100%', maxWidth: 880, alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 6 }}>
        <Row style={{ gap: 8, justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}><Txt kind="label">{L.compareTitle(comparisonItems.length)}</Txt>
            <Txt kind="small" numberOfLines={2}>{comparisonItems.length === 1 ? L.compareNeedTwo : comparisonItems.map(item => item.name).join(' · ')}</Txt>
          </View><Button compact variant="quiet" title={t('clear')} label={L.clearCompare} onPress={clearComparison}/>
          {comparisonItems.length > 1 && <Button compact title={L.compare} label={`${L.compareCta(comparisonItems.length)}: ${comparisonItems.map(item => item.name).join(', ')}`} onPress={() => router.push('/compare')}/>}
        </Row>
      </View></View>}
    <Modal visible={sheet} transparent animationType="slide" accessibilityLabel={sheetPane === 'sort' ? t('sort') : L.filtersTitle} onRequestClose={() => setSheetContext(null)}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#2D173A66' }}>
        <Pressable accessible={false} onPress={() => setSheetContext(null)} style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }}/>
        <SafeAreaView edges={['bottom']} accessibilityViewIsModal
          style={{ maxHeight: '92%', width: '100%', maxWidth: 640, alignSelf: 'center', borderTopLeftRadius: 22, borderTopRightRadius: 22, backgroundColor: colors.surface, direction: 'ltr' }}>
          <View style={styles.handle}/>
          <Row style={{ paddingHorizontal: 18, paddingVertical: 4, justifyContent: 'space-between', borderBottomWidth: 1, borderColor: colors.border }}>
            <Txt kind="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>{sheetPane === 'sort' ? t('sort') : L.filtersTitle}</Txt>
            <Button compact variant="quiet" title={L.cancel} onPress={() => setSheetContext(null)}/>
          </Row>
          {sheetPane === 'sort' ? <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 16 }}>
            <View accessibilityRole="radiogroup" accessibilityLabel={t('sort')} style={{ gap: 7 }}>
              {(['recommended', 'lowPrice', 'highPrice'] as ResultSort[]).map(sort => {
                const selected = applied.sort === sort;
                return <Pressable key={sort} accessibilityRole="radio" accessibilityLabel={t(sort)} aria-checked={selected} accessibilityState={{ checked: selected }}
                  onPress={() => {
                    if (currentContext.current !== sheetContext) return;
                    apply({ ...applied, sort });
                    setSheetContext(null);
                  }} style={({ pressed }) => [styles.sortOption, selected && styles.activeTool, pressed && styles.pressed]}>
                  <Row style={{ justifyContent: 'space-between', gap: 8 }}>
                    <Txt kind="label" style={{ flex: 1 }}>{t(sort)}</Txt><View style={[styles.radio, selected && styles.selectedRadio]}>
                      {selected && <Icon name="check" color={colors.surface} size={15}/>}
                    </View>
                  </Row>
                </Pressable>;
              })}
            </View>
          </ScrollView> : <>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Field label={L.name} placeholder={L.nameHint} value={draft.name} maxLength={120} autoCorrect={false} onChangeText={name => setDraft(value => ({ ...value, name }))}/>
            <Field label={`${L.budget} · ${criteria?.currency || ''}`} placeholder={L.budgetHint} value={draft.maxBudget} maxLength={30} keyboardType="decimal-pad" ltr
              error={preview.budget.valid ? undefined : L.budgetError} onChangeText={maxBudget => setDraft(value => ({ ...value, maxBudget }))}/>
            <Txt kind="small">{L.budgetHelp}</Txt>
            <View style={{ gap: 6 }}><Row style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}><Txt kind="label">{L.stars}</Txt>
              <Button compact variant="quiet" title={L.allStars} onPress={() => setDraft(value => ({ ...value, stars: [] }))}/></Row>
              <Row style={{ flexWrap: 'wrap' }}>{[5, 4, 3, 2, 1, 0].map(star => {
                const selected = draft.stars.includes(star), count = preview.facetCounts[star];
                return <Pressable key={star} accessibilityRole="checkbox" aria-checked={selected} accessibilityState={{ checked: selected }}
                  accessibilityLabel={star ? L.starChoice(star, count) : L.unknownChoice(count)}
                  onPress={() => setDraft(value => ({ ...value, stars: selected ? value.stars.filter(item => item !== star) : [...value.stars, star] }))}
                  style={{ minHeight: 48, padding: 13, borderWidth: 1, borderColor: selected ? colors.blueStrong : colors.border, borderRadius: 13, backgroundColor: selected ? colors.softBlue : colors.surface }}><Txt kind="label">{selected ? '✓ ' : ''}{star ? `${star} ★` : L.unknownStars} · {count}</Txt></Pressable>;
              })}</Row>
            </View>
          </ScrollView>
          <Row style={{ paddingHorizontal: 16, paddingVertical: 8, justifyContent: 'space-between', flexWrap: 'wrap', gap: 6, borderTopWidth: 1, borderColor: colors.border }}>
            <Button compact variant="quiet" title={L.resetDraft} onPress={() => setDraft({ ...emptyResultFilters(), sort: applied.sort })}/><Button title={L.apply(preview.hotels.length)} disabled={!preview.budget.valid} onPress={() => {
              if (currentContext.current !== sheetContext || !preview.budget.valid) return;
              apply(draft); setSheetContext(null);
            }}/></Row></>}
        </SafeAreaView>
      </View>
    </Modal>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  summary: { borderRadius: 22, backgroundColor: colors.primary, paddingHorizontal: 17, paddingVertical: 13 },
  destination: { fontSize: 30, lineHeight: 39, color: colors.surface },
  edit: { justifyContent: 'center', minHeight: 48, paddingHorizontal: 12, gap: 5, borderRadius: 16, backgroundColor: colors.lilac },
  tool: { flexGrow: 1, minHeight: 48, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: colors.border, borderRadius: 15, backgroundColor: colors.surface },
  toolContents: { justifyContent: 'center', gap: 6 },
  activeTool: { borderColor: colors.grape, backgroundColor: colors.lavenderMist },
  sortIcon: { fontSize: 18, lineHeight: 23, color: colors.navy },
  pressed: { opacity: .8 },
  note: { fontSize: 13, lineHeight: 20 },
  loading: { borderRadius: 20, padding: 18, backgroundColor: colors.lavenderMist },
  handle: { alignSelf: 'center', marginTop: 8, width: 38, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sortOption: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 15, paddingVertical: 8, borderRadius: 15, borderWidth: 1, borderColor: colors.border },
  radio: { width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.muted },
  selectedRadio: { backgroundColor: colors.navy, borderColor: colors.navy },
});
