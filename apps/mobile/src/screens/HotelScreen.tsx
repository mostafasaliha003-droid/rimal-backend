import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, authSession } from '../api';
import { useAuth } from '../auth';
import type { HotelDetails, SearchCriteria } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { useAppState } from '../components/AppState';
import ApiState from '../components/ApiState';
import { Button, Field, Icon, Row, StatePanel, Txt } from '../components/Primitives';
import HotelGallery from '../components/HotelGallery';
import HotelAbout from '../components/HotelAbout';
import RoomOfferPicker from '../components/RoomOfferPicker';
import { useCancellationClock } from '../components/useCancellationClock';
import { buildRoomChoices, roomHotelId, type MealFacet, type RoomChoiceEntry, type RoomChoiceGroup, type RoomChoiceSort } from '../components/roomChoiceModel';
import MealPlanPicker from '../components/MealPlanPicker';
import RoomComparison from '../components/RoomComparison';
import RoomTypePicker, { type RoomTypeSelection } from '../components/RoomTypePicker';
import { rateCopy } from '../components/roomRateFacts';
import { roomChoiceCopy } from '../components/roomChoiceCopy';
import { displayTravelDate } from '../components/searchJourneyModel';

type Section = 'rooms' | 'about';

function ChoiceChip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={selected === undefined ? undefined : { selected }} aria-pressed={selected} onPress={onPress}
    style={({ pressed }) => [styles.chip, { backgroundColor: selected ? colors.navy : colors.surface,
      borderColor: selected ? colors.navy : colors.border, opacity: pressed ? .75 : 1 }]}>
    <Txt kind="label" style={{ color: selected ? colors.surface : colors.navy }}>{label}</Txt>
  </Pressable>;
}

function FreeCancellationFilter({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const { language, rtl } = useLanguage();
  const label = roomChoiceCopy(language).freeOnly;
  if (Platform.OS === 'web') {
    return <label dir={rtl ? 'rtl' : 'ltr'} style={{
      display: 'flex', alignItems: 'center', gap: 10, minHeight: 48, cursor: 'pointer',
      color: colors.navy, fontFamily: fonts.bold, fontSize: 15,
    }}>
      <input type="checkbox" aria-label={label} checked={checked} onChange={event => onChange(event.currentTarget.checked)}
        style={{ accentColor: colors.navy, margin: 0, width: 26, height: 26, flexShrink: 0 }}/>
      <span>{label}</span>
    </label>;
  }
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked }}
    onPress={() => onChange(!checked)} style={({ pressed }) => [styles.freeFilter, { opacity: pressed ? .75 : 1 }]}>
    <Row style={{ alignItems: 'center', gap: 10 }}>
      <View accessible={false} style={[styles.check, checked && { backgroundColor: colors.navy }]}>
        {checked && <Txt accessible={false} style={{ color: colors.surface }}>✓</Txt>}
      </View>
      <Txt kind="label" style={{ flexShrink: 1 }}>{label}</Txt>
    </Row>
  </Pressable>;
}

function RoomGroup({ now, group, requestedCurrency, onReview, reviewError, onRefresh, onEditSearch, selected, onToggle, showCompare, chosenKey, choose }: {
  now: number; group: RoomChoiceGroup; requestedCurrency: string; onReview: (entry: RoomChoiceEntry) => void; reviewError: string;
  onRefresh: () => void; onEditSearch: () => void; selected: RoomChoiceEntry[]; onToggle: (entry: RoomChoiceEntry) => void; showCompare: boolean;
  chosenKey: string | null; choose: (key: string) => void;
}) {
  const { language, t } = useLanguage(); const short = rateCopy(language);
  const first = group.lowestReviewable || group.entries[0], multiple = group.entries.length > 1;
  const active = group.entries.find(entry => entry.key === chosenKey) || first;
  const options = multiple ? [first, ...group.entries.filter(entry => entry.key !== first.key)] : group.entries;
  const parts = group.name.match(/^(.+?)\s+\(([^()]+)\)$/);
  const qualifier = parts?.[2];
  const title = parts?.[1] ?? group.name;
  return <View style={[ui.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
    <View testID={`room-group-header-${group.entries[0].index + 1}`} style={styles.roomHeader}>
      {active.offer.images.length > 0 && <HotelGallery key={active.key} images={active.offer.images} name={active.offer.name} room/>}
      <Row style={{ alignItems: 'flex-start', gap: 10 }}>
        {!active.offer.images.length && <View style={styles.roomIcon}><Icon name="bed" size={24} color={colors.violetInk}/></View>}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt accessibilityRole="header" accessibilityLabel={group.name} kind="heading" style={styles.roomName}>{title}</Txt>
          {qualifier && <Txt kind="small" style={{ color: colors.ink }}>{qualifier}</Txt>}
          {multiple && <Txt kind="label" style={{ color: colors.violetInk }}>{short.plans(group.entries.length)}</Txt>}
          {!active.offer.images.length && <Txt kind="small" style={{ fontSize: 12, lineHeight: 18 }}>{t('roomPhotoUnknown')}</Txt>}
        </View>
      </Row>
    </View>
    <RoomOfferPicker entries={options} selected={active} preferredKey={group.lowestReviewable?.key} groupName={group.name}
      currency={requestedCurrency} now={now} comparison={selected} reviewError={reviewError} showCompare={showCompare}
      onSelect={entry => choose(entry.key)} onToggle={onToggle} onReview={onReview} onRefresh={onRefresh} onEditSearch={onEditSearch}/>
  </View>;
}

function HotelContents({ hotel, hid, criteria, onRefresh }: { hotel: HotelDetails; hid: number; criteria: SearchCriteria; onRefresh: () => void }) {
  const { language, t } = useLanguage(); const copy = roomChoiceCopy(language);
  const { saved, toggleSaved, savedReady, savedErrorKind, retrySaved, setReviewDraft } = useAppState();
  const { status: authStatus, sessionRevision } = useAuth();
  const router = useRouter(); const { width } = useWindowDimensions();
  const short = rateCopy(language);
  const [section, setSection] = useState<Section>('rooms');
  const [guideEntry, setGuideEntry] = useState<{ section: 'arrival' | 'location'; visit: number }>({ section: 'arrival', visit: 0 });
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const tabTop = useRef(0);
  const position = useRef(0);
  const showSection = (next: Section) => {
    if (position.current > tabTop.current) scroller.current?.scrollTo({ y: tabTop.current, animated: false });
    if (next === 'about' && section !== 'about') setGuideEntry(previous => ({ section: 'arrival', visit: previous.visit + 1 }));
    setSection(next);
  };
  const showLocation = () => {
    setGuideEntry(previous => ({ section: 'location', visit: previous.visit + 1 }));
    setSection('about');
    scroller.current?.scrollTo({ y: tabTop.current, animated: false });
  };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [roomType, setRoomType] = useState<RoomTypeSelection | null>(null);
  const [chosenByRoom, setChosenByRoom] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<RoomChoiceEntry[]>([]);
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const toggleComparison = (entry: RoomChoiceEntry) => setSelected(current => current.some(item => item.key === entry.key)
    ? current.filter(item => item.key !== entry.key) : current.length < 2 ? [...current, entry] : current);
  const [query, setQuery] = useState(''); const [meal, setMeal] = useState<MealFacet>({ kind: 'all' });
  const [sort, setSort] = useState<RoomChoiceSort>('original'); const [groupLimit, setGroupLimit] = useState(4);
  const [reviewError, setReviewError] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const cancellations = useMemo(() => hotel.offers.map(offer => offer.cancellation), [hotel.offers]);
  const now = useCancellationClock(cancellations);
  const model = useMemo(() => buildRoomChoices(hotel.offers, { currency: criteria.currency, query, meal, roomKey: roomType?.key, sort, freeOnly, now }),
    [hotel.offers, criteria.currency, query, meal, roomType, sort, freeOnly, now]);
  const clear = () => { setRoomType(null); setQuery(''); setMeal({ kind: 'all' }); setFreeOnly(false); setSort('original'); };
  const review = (entry: RoomChoiceEntry) => {
    setReviewError('');
    if (authSession.getRevision() !== sessionRevision || authSession.getSnapshot().status !== authStatus) { setReviewError(entry.key); return; }
    // Pass the exact source offer. Display grouping/filtering never rebuilds or
    // substitutes a hash, price, tax, policy or signed capability.
    const accepted = setReviewDraft({ hid, hotelName: hotel.name, hotelAddress: hotel.address,
      hotelImage: hotel.images[0], criteria, offer: entry.offer, language });
    if (accepted) router.push('/review'); else setReviewError(entry.key);
  };
  const filtered = Boolean(roomType || query.trim() || meal.kind !== 'all' || freeOnly || sort !== 'original');
  const savedHere = saved.includes(hid);
  const guestCount = criteria.guests.reduce((sum, room) => sum + room.adults + room.children.length, 0);
  return <>
    <ScrollView ref={scroller} stickyHeaderIndices={[1]} scrollEventThrottle={32}
      onScroll={event => { position.current = event.nativeEvent.contentOffset.y; }}
      style={{ flex: 1 }} contentContainerStyle={[ui.page, { paddingHorizontal: width < 380 ? 12 : 16, paddingTop: 4, gap: 12 }]}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}>
      <View style={{ gap: 12 }} onLayout={({ nativeEvent: { layout } }) => { tabTop.current = layout.y + layout.height + 12; }}>
        <HotelGallery images={hotel.images} name={hotel.name}/>
        <Row style={{ alignItems: 'flex-start', gap: 10 }}><View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {Number.isInteger(hotel.stars) && hotel.stars! >= 1 && hotel.stars! <= 5 && <Txt accessibilityLabel={copy.stars(hotel.stars!)} style={{ color: colors.goldInk, fontSize: 13, lineHeight: 18 }}>{'★'.repeat(hotel.stars!)}</Txt>}
          <Txt accessibilityRole="header" kind="title" style={styles.propertyName}>{hotel.name}</Txt>
          {hotel.address && <Pressable testID="hotel-location-link" accessibilityRole="button" accessibilityLabel={`${language === 'ar' ? 'موقع الفندق' : 'Hotel location'} · ${hotel.address}`}
            onPress={showLocation} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Row style={{ gap: 6, alignItems: 'center' }}><Icon name="pin" size={17} color={colors.violetInk}/>
              <Txt kind="small" numberOfLines={2} style={{ flex: 1, color: colors.violetInk }}>{hotel.address}</Txt><Icon name="chevron" size={14} color={colors.violetInk}/></Row>
          </Pressable>}
        </View><Pressable accessibilityRole="button" accessibilityLabel={t(savedHere ? 'removeSaved' : 'saveStay')} aria-pressed={savedHere}
          accessibilityState={{ disabled: !savedReady, selected: savedHere }} disabled={!savedReady} onPress={() => toggleSaved(hid)}
          style={[styles.save, savedHere && { backgroundColor: colors.pistachioMist }, { opacity: savedReady ? 1 : .5 }]}><Icon name={savedHere ? 'check' : 'saved'} size={22} color={savedHere ? colors.success : colors.violetInk}/></Pressable></Row>
        {savedErrorKind && <View style={ui.card}><Txt accessibilityRole="alert">{t(savedErrorKind === 'load' ? 'savedError' : 'savedSaveFailed')}</Txt>
        <Button variant="quiet" title={t('retry')} onPress={() => void retrySaved()}/></View>}
        <Row style={styles.stayContext}>
          <Row style={{ gap: 5, flexShrink: 1 }}><Icon name="calendar" size={16} color={colors.violetInk}/>
            <Txt kind="small" style={{ color: colors.ink, flexShrink: 1 }} accessibilityLabel={short.dates(criteria.checkin, criteria.checkout)}>{short.dates(displayTravelDate(criteria.checkin, language), displayTravelDate(criteria.checkout, language))}</Txt></Row>
          <Row style={{ gap: 5, flexShrink: 1 }}><Icon name="users" size={16} color={colors.violetInk}/>
            <Txt kind="small" style={{ color: colors.ink, flexShrink: 1 }}>{copy.staySummary(guestCount, criteria.guests.length)}</Txt></Row>
        </Row>
      </View>
      <View accessibilityRole="tablist" style={{ backgroundColor: colors.canvas, paddingVertical: 4 }}>
        <Row style={styles.tabs}>
          {(['rooms', 'about'] as const).map(key => <Pressable key={key} accessibilityRole="tab" aria-selected={section === key} accessibilityState={{ selected: section === key }}
            testID={`hotel-tab-${key}`} onPress={() => showSection(key)} style={[styles.tab, section === key && styles.activeTab]}>
            <Row style={{ justifyContent: 'center', gap: 6 }}><Icon name={key === 'rooms' ? 'bed' : 'info'} size={17} color={section === key ? colors.surface : colors.muted}/>
              <Txt kind="label" style={{ textAlign: 'center', color: section === key ? colors.surface : colors.muted }}>{key === 'rooms' ? copy.rooms : short.overview}</Txt></Row>
          </Pressable>)}
        </Row>
      </View>
      {section === 'rooms' ? <View style={{ gap: 12 }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <Txt accessibilityRole="header" kind="heading" style={{ flex: 1, fontSize: 23, lineHeight: 31 }}>{copy.roomsTitle}</Txt>
          {hotel.offers.length > 0 && <Txt accessibilityLiveRegion="polite" kind="small" style={{ color: colors.violetInk }}>{short.plans(model.matchingOffers)}</Txt>}
        </Row>
        {hotel.offers.length > 0 && <Row style={{ flexWrap: 'wrap', gap: 8 }}>
          {model.totalGroups > 1 && <RoomTypePicker groups={model.roomTypes} value={roomType} onChange={setRoomType}/>}
          <MealPlanPicker value={meal} options={model.mealOptions} onChange={setMeal}/>
          <Pressable testID="room-filters-toggle" accessibilityRole="button" accessibilityState={{ expanded: filtersOpen }}
            aria-expanded={filtersOpen} onPress={() => setFiltersOpen(value => !value)}
            style={[styles.compareControl, filtered && { backgroundColor: colors.softBlue }]}>
            <Row style={{ gap: 5 }}><Icon name="filter" size={17}/><Txt kind="label">{short.filters}{filtered ? ' ●' : ''}</Txt></Row>
          </Pressable>
        </Row>}
        {hotel.offers.length === 0 ? <StatePanel title={t('noOffers')}/> : <>
          {filtersOpen && <View style={[ui.card, { padding: 14, gap: 10 }]}>
            <Field label={copy.roomSearch} placeholder={copy.roomSearchHint} value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" returnKeyType="search"/>
            <FreeCancellationFilter checked={freeOnly} onChange={setFreeOnly}/>
            <Row style={{ flexWrap: 'wrap', gap: 8 }}><ChoiceChip label={copy.original} selected={sort === 'original'} onPress={() => setSort('original')}/>
              <ChoiceChip label={copy.lowest(criteria.currency)} selected={sort === 'price'} onPress={() => setSort('price')}/></Row>
            <Txt accessibilityLiveRegion="polite" kind="small">{copy.count(model.matchingOffers, model.totalOffers, model.groups.length)}</Txt>
            {filtered && <Button variant="quiet" title={copy.clear} onPress={clear}/>}
          </View>}
          {model.groups.length === 0 ? <View style={{ gap: 12 }}><StatePanel title={copy.noMatch} body={copy.noMatchBody}/><Button variant="secondary" title={copy.clear} onPress={clear}/></View>
            : <>{model.groups.slice(0, groupLimit).map(group => <RoomGroup key={group.key} group={group} now={now} selected={selected}
              chosenKey={chosenByRoom[group.key] ?? null} choose={key => setChosenByRoom(previous => ({ ...previous, [group.key]: key }))}
              showCompare={model.totalOffers > 1} onToggle={toggleComparison} requestedCurrency={criteria.currency}
              onReview={review} reviewError={reviewError} onRefresh={onRefresh} onEditSearch={() => router.push('/')}/>)}

              {groupLimit < model.groups.length && <Button variant="secondary" title={copy.moreGroups(model.groups.length - groupLimit)} onPress={() => setGroupLimit(value => value + 6)}/>}</>}
        </>}
      </View> : <HotelAbout key={guideEntry.visit} initialSection={guideEntry.section} hotel={hotel} criteria={criteria} onChooseRooms={() => showSection('rooms')}/>}
    </ScrollView>
    {section === 'rooms' && selected.length > 0 && <View style={styles.dock}><Row style={styles.dockInner}>
      <View style={{ flex: 1, minWidth: 0 }}><Txt kind="label" accessibilityLiveRegion="polite">{short.compareCount(selected.length)}</Txt>
        {selected.length === 1 && <Txt kind="small">{short.selectAnother}</Txt>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={short.clear} onPress={() => setSelected([])} style={styles.clearCompare}><Icon name="close" size={18}/></Pressable>
      {selected.length === 2 && <View testID="compare-rates-open"><Button compact title={short.compareTitle} onPress={() => setComparisonOpen(true)}/></View>}
    </Row></View>}
    <RoomComparison visible={comparisonOpen} entries={selected} now={now} currency={criteria.currency} onClose={() => setComparisonOpen(false)} onReview={review}/>
  </>;
}

export default function HotelScreen() {
  const { hid: parameter } = useLocalSearchParams<{ hid?: string | string[] }>();
  const hid = roomHotelId(parameter); const { criteria } = useAppState(); const { language, t } = useLanguage();
  const { user, status: authStatus, sessionRevision } = useAuth(); const router = useRouter(); const copy = roomChoiceCopy(language);
  const [result, setResult] = useState<{ key: string; hotel: HotelDetails | null; error: unknown }>({ key: '', hotel: null, error: null });
  const [refresh, setRefresh] = useState(0);
  const requestKey = JSON.stringify([hid, criteria, language, refresh, user?.email, authStatus, sessionRevision]);
  const hotel = result.key === requestKey ? result.hotel : null;
  const error = result.key === requestKey ? result.error : null;
  const loading = Boolean(hid && criteria && result.key !== requestKey);
  useEffect(() => {
    if (!criteria || hid === null) return;
    const controller = new AbortController();
    api.getHotel(hid, criteria, language, controller.signal).then(value => {
      if (!controller.signal.aborted) setResult({ key: requestKey, hotel: value, error: null });
    }).catch(failure => { if (!controller.signal.aborted) setResult({ key: requestKey, hotel: null, error: failure }); });
    return () => controller.abort();
  }, [hid, criteria, language, requestKey]);
  const refreshHotel = () => setRefresh(value => value + 1);
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}><BrandHeader back/>
    {hid === null ? <ScrollView contentContainerStyle={ui.page}><StatePanel title={copy.invalidHotel} body={copy.invalidHotelBody}/><Button title={t('search')} onPress={() => router.replace('/')}/></ScrollView>
      : !criteria ? <ScrollView contentContainerStyle={ui.page}><StatePanel title={t('datesRequired')} body={t('datesRequiredBody')}/><Button title={t('search')} onPress={() => router.push('/')}/></ScrollView>
        : loading ? <ScrollView contentContainerStyle={ui.page}><StatePanel title={t('loading')} busy/></ScrollView>
          : error ? <ScrollView contentContainerStyle={ui.page}><ApiState error={error} retry={refreshHotel}/></ScrollView>
            : hotel ? <HotelContents key={requestKey} hotel={hotel} hid={hid} criteria={criteria} onRefresh={refreshHotel}/>
              : <ScrollView contentContainerStyle={ui.page}><StatePanel title={t('noOffers')} retry={refreshHotel}/></ScrollView>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  freeFilter: { minHeight: 48, justifyContent: 'center', alignSelf: 'stretch' },
  check: { width: 26, height: 26, borderWidth: 2, borderColor: colors.navy, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  chip: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 11, borderWidth: 1, borderRadius: 15, justifyContent: 'center', flexShrink: 1 },
  propertyName: { fontSize: 26, lineHeight: 34 },
  save: { minWidth: 48, minHeight: 48, padding: 8, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.lavenderMist },
  stayContext: { gap: 12, rowGap: 5, justifyContent: 'space-between', flexWrap: 'wrap', borderRadius: 12,
    backgroundColor: colors.lavenderMist, paddingVertical: 8, paddingHorizontal: 11 },
  tabs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 3, borderRadius: 16, gap: 2 },
  tab: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, borderRadius: 12 },
  activeTab: { backgroundColor: colors.primary },
  roomHeader: { gap: 12, padding: 14, backgroundColor: colors.surface },
  roomIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: colors.lavenderMist },
  roomName: { fontSize: 21, lineHeight: 28 },
  compareControl: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  clearCompare: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dock: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  dockInner: { width: '100%', maxWidth: 880, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
});
