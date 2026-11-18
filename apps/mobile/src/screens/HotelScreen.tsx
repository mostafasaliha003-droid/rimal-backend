import React, { useEffect, useMemo, useState } from 'react';
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
import HotelMapLink from '../components/HotelMapLink';
import Cancellation from '../components/Cancellation';
import { useCancellationClock } from '../components/useCancellationClock';
import Policies from '../components/Policies';
import Taxes from '../components/Taxes';
import { buildRoomChoices, canReviewRoomOffer, roomHotelId, type MealFacet, type RoomChoiceEntry, type RoomChoiceGroup, type RoomChoiceSort } from '../components/roomChoiceModel';
import { CancellationSummary, MealBadge } from '../components/RateHighlights';
import MealPlanPicker from '../components/MealPlanPicker';
import RoomComparison from '../components/RoomComparison';
import { rateCopy, roomRateFacts } from '../components/roomRateFacts';
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

function RateReviewError({ onRefresh }: { onRefresh: () => void }) {
  const { t } = useLanguage();
  return <View style={{ gap: 10 }}>
    <Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('reviewExpiredBody')}</Txt>
    <Button variant="secondary" title={t('retry')} onPress={onRefresh}/>
  </View>;
}

function RateOption({ entry, groupName, requestedCurrency, now, checked, comparisonFull, showCompare, onToggle, onReview, reviewError, onRefresh, onEditSearch }: {
  entry: RoomChoiceEntry; groupName: string; requestedCurrency: string; now: number; checked: boolean; comparisonFull: boolean; showCompare: boolean;
  onToggle: (entry: RoomChoiceEntry) => void; onReview: (entry: RoomChoiceEntry) => void; reviewError: string;
  onRefresh: () => void; onEditSearch: () => void;
}) {
  const { language, t } = useLanguage();
  const copy = rateCopy(language), roomCopy = roomChoiceCopy(language), offer = entry.offer, number = entry.index + 1;
  const facts = roomRateFacts(offer, language, now);
  const [details, setDetails] = useState(false);
  const reviewable = canReviewRoomOffer(offer, requestedCurrency);
  const canCompare = checked || !comparisonFull;
  const mismatch = Boolean(offer.price && offer.price.currency !== requestedCurrency);
  const reviewLabel = `${roomCopy.reviewRate(number)} · ${offer.name}`;
  const factsList = [
    ...(offer.bedding ? [{ key: 'bedding' as const, icon: 'bed' as const }] : []),
    { key: 'payment', icon: 'info' }, { key: 'fees', icon: 'pin' },
  ] as const;
  return <View style={styles.ratePlan}>
    <Row style={{ alignItems: 'center', gap: 10 }}>
      <View style={{ gap: 1, flex: 1, minWidth: 0 }}>
        {offer.name !== groupName && <Txt kind="label">{offer.name}</Txt>}
        <Txt kind="small">{copy.price}</Txt><Txt kind="heading" style={{ writingDirection: 'ltr' }}>{facts.price}</Txt>
      </View>
      {showCompare && <Pressable testID={`compare-rate-${number}`} accessibilityRole="checkbox" accessibilityLabel={`${copy.compare} · ${reviewLabel}`}
        accessibilityState={{ checked, disabled: !canCompare }} disabled={!canCompare} onPress={() => onToggle(entry)}
        style={[styles.compareControl, checked && { backgroundColor: colors.softBlue }, !canCompare && { opacity: .55 }]}>
        <Row style={{ gap: 5 }}><Icon name={checked ? 'check' : 'compare'} size={16}/><Txt kind="label">{checked ? copy.selected : copy.compare}</Txt></Row>
      </Pressable>}
    </Row>
    <MealBadge offer={offer}/>
    <CancellationSummary decision={facts.decision}/>
    <View style={{ gap: 6 }}>
      {factsList.map(({ key, icon }) => <Row key={key} style={{ gap: 9, alignItems: 'flex-start' }}>
        <View style={{ paddingTop: 3 }}><Icon name={icon} size={16} color={colors.muted}/></View>
        <Txt kind="small" style={{ flex: 1 }}><Txt kind="small">{copy[key]} · </Txt><Txt kind="small" style={{ color: colors.ink, fontFamily: fonts.medium }}>{facts[key]}</Txt></Txt>
      </Row>)}
    </View>
    <Row style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <View testID={`review-rate-${number}`} style={{ flexGrow: 1, flexBasis: 136 }}>
        <Button compact title={copy.choose} label={reviewLabel} disabled={!reviewable} onPress={() => onReview(entry)}/>
      </View>
      <Pressable testID={`terms-rate-${number}`} accessibilityRole="button" accessibilityState={{ expanded: details }} aria-expanded={details}
        accessibilityLabel={`${copy.terms} · ${reviewLabel}`} onPress={() => setDetails(value => !value)} style={styles.termsControl}>
        <Txt kind="label" style={{ textAlign: 'center' }}>{copy.terms}</Txt>
      </Pressable>
    </Row>
    {!reviewable && <View style={{ gap: 4 }}>
      <Txt kind="small">{mismatch ? roomCopy.currencyMismatch(offer.price!.currency, requestedCurrency) : roomCopy.notReady}</Txt>
      <Button variant="quiet" title={mismatch ? t('searchAgain') : t('retry')} onPress={mismatch ? onEditSearch : onRefresh}/>
    </View>}
    {reviewError === entry.key && <RateReviewError onRefresh={onRefresh}/>}
    {details && <View style={styles.details}>
      {offer.images.length > 0 && <HotelGallery images={offer.images} name={offer.name} room/>}
      <Taxes taxes={offer.taxes}/><View style={ui.rule}/><Cancellation offer={offer} now={now}/>
    </View>}
  </View>;
}

function RoomGroup({ now, group, requestedCurrency, onReview, reviewError, onRefresh, onEditSearch, selected, onToggle, showCompare }: {
  now: number; group: RoomChoiceGroup; requestedCurrency: string; onReview: (entry: RoomChoiceEntry) => void; reviewError: string;
  onRefresh: () => void; onEditSearch: () => void; selected: RoomChoiceEntry[]; onToggle: (entry: RoomChoiceEntry) => void; showCompare: boolean;
}) {
  const { language } = useLanguage(); const copy = roomChoiceCopy(language); const short = rateCopy(language);
  const [expanded, setExpanded] = useState(false), [limit, setLimit] = useState(4);
  const first = group.lowestReviewable || group.entries[0], multiple = group.entries.length > 1;
  const visible = expanded ? [first, ...group.entries.filter(entry => entry.key !== first.key)].slice(0, limit) : [first];
  return <View style={[ui.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
    <View testID={`room-group-header-${group.entries[0].index + 1}`} style={styles.roomHeader}>
      <Row style={{ alignItems: 'center', gap: 10 }}>
        <View style={styles.roomThumb}><HotelGallery images={first.offer.images} name={first.offer.name} room thumbnail/></View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}><Txt accessibilityRole="header" kind="heading" style={{ fontSize: 17, lineHeight: 24 }}>{group.name}</Txt>
          <Txt kind="small">{short.plans(group.entries.length)}</Txt>
        </View>
      </Row>
    </View>
    {visible.map(entry => <View key={entry.key} testID={entry.key === group.lowestReviewable?.key && multiple ? 'lowest-reviewable-rate' : undefined}>
      <RateOption entry={entry} groupName={group.name} now={now} requestedCurrency={requestedCurrency} checked={selected.some(item => item.key === entry.key)}
        comparisonFull={selected.length === 2} showCompare={showCompare} onToggle={onToggle} onReview={onReview} reviewError={reviewError} onRefresh={onRefresh} onEditSearch={onEditSearch}/>
    </View>)}
    {expanded && limit < group.entries.length && <Button variant="quiet" title={copy.moreRates(group.entries.length - limit)} onPress={() => setLimit(value => value + 4)}/>}
    {multiple && <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded}
      onPress={() => setExpanded(value => !value)} style={styles.groupExpand}>
      <Row style={{ justifyContent: 'center', gap: 8 }}><Txt kind="label">{expanded ? copy.hideRates : copy.showRates(group.entries.length)}</Txt><Txt accessible={false} kind="label">{expanded ? '−' : '+'}</Txt></Row>
    </Pressable>}
  </View>;
}

function HotelContents({ hotel, hid, criteria, onRefresh }: { hotel: HotelDetails; hid: number; criteria: SearchCriteria; onRefresh: () => void }) {
  const { language, t } = useLanguage(); const copy = roomChoiceCopy(language);
  const { saved, toggleSaved, savedReady, savedErrorKind, retrySaved, setReviewDraft } = useAppState();
  const { status: authStatus, sessionRevision } = useAuth();
  const router = useRouter(); const { width } = useWindowDimensions();
  const short = rateCopy(language);
  const [section, setSection] = useState<Section>('rooms');
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const model = useMemo(() => buildRoomChoices(hotel.offers, { currency: criteria.currency, query, meal, sort, freeOnly, now }),
    [hotel.offers, criteria.currency, query, meal, sort, freeOnly, now]);
  const clear = () => { setQuery(''); setMeal({ kind: 'all' }); setFreeOnly(false); setSort('original'); };
  const review = (entry: RoomChoiceEntry) => {
    setReviewError('');
    if (authSession.getRevision() !== sessionRevision || authSession.getSnapshot().status !== authStatus) { setReviewError(entry.key); return; }
    // Pass the exact source offer. Display grouping/filtering never rebuilds or
    // substitutes a hash, price, tax, policy or signed capability.
    const accepted = setReviewDraft({ hid, hotelName: hotel.name, hotelAddress: hotel.address,
      hotelImage: hotel.images[0], criteria, offer: entry.offer, language });
    if (accepted) router.push('/review'); else setReviewError(entry.key);
  };
  const filtered = Boolean(query.trim() || meal.kind !== 'all' || freeOnly || sort !== 'original');
  const savedHere = saved.includes(hid);
  const guestCount = criteria.guests.reduce((sum, room) => sum + room.adults + room.children.length, 0);
  return <>
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[ui.page, { paddingHorizontal: width < 380 ? 12 : 16, gap: 12 }]} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}>
      <View style={{ gap: 9 }}>
        <HotelGallery images={hotel.images} name={hotel.name}/>
        <Row style={{ alignItems: 'flex-start', gap: 10 }}><View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          {Number.isInteger(hotel.stars) && hotel.stars! >= 1 && hotel.stars! <= 5 && <Txt accessibilityLabel={copy.stars(hotel.stars!)} style={{ color: colors.goldInk, fontSize: 13, lineHeight: 18 }}>{'★'.repeat(hotel.stars!)}</Txt>}
          <Txt accessibilityRole="header" kind="title" style={{ fontSize: 23, lineHeight: 32 }}>{hotel.name}</Txt>
          {hotel.address && <Row style={{ gap: 5, alignItems: 'flex-start' }}><Icon name="pin" size={16} color={colors.muted}/><Txt kind="small" style={{ flex: 1 }}>{hotel.address}</Txt></Row>}
        </View><Pressable accessibilityRole="button" accessibilityLabel={t(savedHere ? 'removeSaved' : 'saveStay')} aria-pressed={savedHere}
          accessibilityState={{ disabled: !savedReady, selected: savedHere }} disabled={!savedReady} onPress={() => toggleSaved(hid)}
          style={[styles.save, { opacity: savedReady ? 1 : .5 }]}><Icon name="saved" size={22} color={savedHere ? colors.success : colors.navy}/></Pressable></Row>
        {savedErrorKind && <View style={ui.card}><Txt accessibilityRole="alert">{t(savedErrorKind === 'load' ? 'savedError' : 'savedSaveFailed')}</Txt>
        <Button variant="quiet" title={t('retry')} onPress={() => void retrySaved()}/></View>}
        <Row style={{ gap: 7, flexWrap: 'wrap' }}><Icon name="calendar" size={16} color={colors.muted}/>
          <Txt kind="small" accessibilityLabel={short.dates(criteria.checkin, criteria.checkout)}>{short.dates(displayTravelDate(criteria.checkin, language), displayTravelDate(criteria.checkout, language))}</Txt>
          <Txt kind="small">{'· '}{copy.staySummary(guestCount, criteria.guests.length)}</Txt>
        </Row>
        <Row style={{ gap: 4, backgroundColor: colors.softBlue, padding: 3, borderRadius: 14 }}>
          {(['rooms', 'about'] as const).map(key => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: section === key }}
            onPress={() => setSection(key)} style={[styles.tab, section === key && { backgroundColor: colors.surface }]}>
            <Txt kind="label" style={{ textAlign: 'center', color: section === key ? colors.navy : colors.muted }}>{key === 'rooms' ? copy.rooms : short.overview}</Txt>
          </Pressable>)}
        </Row>
      </View>
      {section === 'rooms' ? <View style={{ gap: 9 }}>
        <Row style={{ gap: 8, alignItems: 'center' }}>
          <View style={{ flex: 1, minWidth: 0 }}><Txt accessibilityRole="header" kind="heading">{copy.roomsTitle}</Txt>
            {hotel.offers.length > 0 && <Txt accessibilityLiveRegion="polite" kind="small">{short.plans(model.matchingOffers)}</Txt>}
          </View>
        </Row>
        {hotel.offers.length > 0 && <Row style={{ flexWrap: 'wrap', gap: 8 }}>
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
            : <>{model.groups.slice(0, groupLimit).map(group => <RoomGroup key={group.key} group={group} now={now} selected={selected} showCompare={model.totalOffers > 1} onToggle={toggleComparison} requestedCurrency={criteria.currency} onReview={review} reviewError={reviewError} onRefresh={onRefresh} onEditSearch={() => router.push('/')}/>)}

              {groupLimit < model.groups.length && <Button variant="secondary" title={copy.moreGroups(model.groups.length - groupLimit)} onPress={() => setGroupLimit(value => value + 6)}/>}</>}
        </>}
      </View> : <View style={{ gap: 12 }}>
        <View style={ui.card}><Txt accessibilityRole="header" kind="heading">{copy.about}</Txt>
          {hotel.description.length ? hotel.description.map((paragraph, index) => <Txt key={index}>{paragraph}</Txt>) : <Txt kind="small">{t('noDescription')}</Txt>}
          {!!hotel.location && <HotelMapLink hotel={hotel}/>}
        </View>
        <View style={ui.card}><Txt accessibilityRole="header" kind="heading">{copy.amenities}</Txt>
          {hotel.amenities.length ? hotel.amenities.map((amenity, index) => <Txt key={`${amenity}-${index}`}>· {amenity}</Txt>) : <Txt kind="small">{t('noAmenities')}</Txt>}
        </View>
        {Object.keys(hotel.policies).length || hotel.policyExtraInfo ? <Policies source={hotel.policies} extra={hotel.policyExtraInfo}/>
          : <View style={ui.card}><Txt accessibilityRole="header" kind="heading">{copy.policies}</Txt><Txt kind="small">{copy.policyUnknown}</Txt></View>}
      </View>}
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
  save: { minWidth: 48, minHeight: 48, padding: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  tab: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 12 },
  roomHeader: { padding: 12, backgroundColor: colors.background },
  roomThumb: { width: 86, borderRadius: 11, overflow: 'hidden' },
  compareControl: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 9, paddingVertical: 4, borderWidth: 1, borderColor: colors.border, borderRadius: 12, backgroundColor: colors.surface },
  termsControl: { flexGrow: 1, flexBasis: 115, minHeight: 44, justifyContent: 'center', paddingHorizontal: 6, paddingVertical: 4 },
  groupExpand: { minHeight: 46, justifyContent: 'center', borderTopWidth: 1, borderTopColor: colors.border, paddingHorizontal: 8 },
  ratePlan: { padding: 14, gap: 12, borderTopWidth: 1, borderTopColor: colors.border },
  details: { gap: 15, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  clearCompare: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dock: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  dockInner: { width: '100%', maxWidth: 880, alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
});
