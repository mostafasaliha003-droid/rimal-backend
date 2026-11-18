import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, authSession } from '../api';
import { useAuth } from '../auth';
import type { HotelDetails, SearchCriteria } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import { useAppState } from '../components/AppState';
import ApiState from '../components/ApiState';
import { Button, Field, MoneyText, Photo, Row, StatePanel, Txt } from '../components/Primitives';
import Cancellation from '../components/Cancellation';
import { useCancellationClock } from '../components/useCancellationClock';
import Policies from '../components/Policies';
import Taxes from '../components/Taxes';
import { buildRoomChoices, canReviewRoomOffer, roomHotelId, roomMealLabel, type MealFacet, type RoomChoiceEntry, type RoomChoiceGroup, type RoomChoiceSort } from '../components/roomChoiceModel';
import { roomChoiceCopy } from '../components/roomChoiceCopy';

type Section = 'rooms' | 'about' | 'amenities' | 'policies';

function ChoiceChip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={selected === undefined ? undefined : { selected }} aria-pressed={selected} onPress={onPress}
    style={({ pressed }) => [styles.chip, { backgroundColor: selected ? colors.navy : colors.surface,
      borderColor: selected ? colors.navy : colors.border, opacity: pressed ? .75 : 1 }]}>
    <Txt kind="label" style={{ color: selected ? colors.surface : colors.navy }}>{label}</Txt>
  </Pressable>;
}

// Mount one supplied image at a time, even for large galleries. Every original
// image remains reachable through labelled controls; no fallback image is invented.
function HotelGallery({ images, name, room = false }: { images: string[]; name: string; room?: boolean }) {
  const { language } = useLanguage(); const copy = roomChoiceCopy(language);
  const [position, setPosition] = useState(0);
  const current = Math.min(position, Math.max(0, images.length - 1));
  return <View style={styles.gallery}>
    <Photo uri={images[current]} label={`${name} · ${copy.photo(current + 1, images.length)}`} room={room} height={room ? 165 : 190}/>
    {images.length > 1 && <>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.previousPhoto} accessibilityState={{ disabled: current === 0 }}
        disabled={current === 0} onPress={() => setPosition(value => Math.max(0, value - 1))}
        style={[styles.photoControl, { left: 10, opacity: current === 0 ? .55 : 1 }]}><Txt accessible={false} style={styles.photoArrow}>‹</Txt></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={copy.nextPhoto} accessibilityState={{ disabled: current === images.length - 1 }}
        disabled={current === images.length - 1} onPress={() => setPosition(value => Math.min(images.length - 1, value + 1))}
        style={[styles.photoControl, { right: 10, opacity: current === images.length - 1 ? .55 : 1 }]}><Txt accessible={false} style={styles.photoArrow}>›</Txt></Pressable>
      <View style={styles.photoCount}><Txt kind="small" accessibilityLiveRegion="polite">{copy.photo(current + 1, images.length)}</Txt></View>
    </>}
  </View>;
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

function RatePlan({ now, entry, requestedCurrency, onReview, failed, onRefresh, onEditSearch }: {
  now: number; entry: RoomChoiceEntry; requestedCurrency: string; onReview: (entry: RoomChoiceEntry) => void; failed: boolean; onRefresh: () => void; onEditSearch: () => void;
}) {
  const { language, t } = useLanguage(); const copy = roomChoiceCopy(language); const offer = entry.offer;
  const reviewable = canReviewRoomOffer(offer, requestedCurrency);
  const currencyMismatch = Boolean(offer.price && offer.price.currency !== requestedCurrency);
  return <View style={styles.ratePlan}>
    <View style={{ gap: 5 }}><Txt kind="small">{copy.rateNumber(entry.index + 1)}</Txt><Txt kind="heading">{offer.name}</Txt></View>
    {offer.images.length > 0 && <HotelGallery images={offer.images} name={offer.name} room/>}
    <Txt kind="small">{copy.meals}: {roomMealLabel(offer.meal, t('roomOnly'), copy.missingMeal, language)}</Txt>
    <View style={styles.ratePrice}><Txt kind="small">{t('priceForStay')}</Txt><MoneyText large money={offer.price}/><Txt kind="small">{copy.priceScope}</Txt></View>
    <Taxes taxes={offer.taxes}/>
    <Cancellation offer={offer} now={now}/>
    <Button title={t('reviewOffer')} disabled={!reviewable} onPress={() => onReview(entry)}/>
    {currencyMismatch ? <View style={{ gap: 10 }}><Txt kind="small">{copy.currencyMismatch(offer.price!.currency, requestedCurrency)}</Txt>
      <Button variant="secondary" title={t('searchAgain')} onPress={onEditSearch}/></View> : !reviewable && <Txt kind="small">{copy.notReady}</Txt>}
    {failed && <View style={{ gap: 10 }}><Txt accessibilityRole="alert" style={{ color: colors.red }}>{t('reviewExpiredBody')}</Txt>
      <Button variant="secondary" title={t('retry')} onPress={onRefresh}/></View>}
  </View>;
}

function RoomGroup({ now, group, requestedCurrency, onReview, reviewError, onRefresh, onEditSearch }: {
  now: number; group: RoomChoiceGroup; requestedCurrency: string; onReview: (entry: RoomChoiceEntry) => void; reviewError: string; onRefresh: () => void; onEditSearch: () => void;
}) {
  const { language } = useLanguage(); const copy = roomChoiceCopy(language);
  const [expanded, setExpanded] = useState(false); const [limit, setLimit] = useState(4);
  const preview = group.entries[0].offer;
  return <View style={[ui.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
    <Pressable accessibilityRole="button" accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(value => !value)}
      style={({ pressed }) => ({ padding: 16, gap: 12, backgroundColor: pressed ? colors.softBlue : colors.surface })}>
      <Row style={{ alignItems: 'flex-start', gap: 12 }}>
        <View style={styles.roomThumb}><Photo uri={preview.images[0]} room label={group.name} height={96}/></View>
        <View style={{ flex: 1, gap: 5 }}><Txt kind="heading" style={{ fontSize: 18, lineHeight: 26 }}>{group.name}</Txt>
          <Txt kind="small">{copy.ratePlans(group.entries.length)}</Txt>
          {group.freeNowCount > 0 && <Txt kind="small">{copy.freeCount(group.freeNowCount, group.entries.length)}</Txt>}
          {group.fromPrice ? <View><Txt kind="small">{copy.from}</Txt><MoneyText money={group.fromPrice}/></View> : <Txt kind="small">{copy.openPrices}</Txt>}
        </View>
      </Row>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}><Txt kind="label" style={{ color: colors.blueStrong }}>{expanded ? copy.hideRates : copy.showRates(group.entries.length)}</Txt><Txt accessible={false}>{expanded ? '−' : '+'}</Txt></Row>
      {group.entries.length !== group.totalCount && <Txt kind="small">{copy.filteredCount(group.entries.length, group.totalCount)}</Txt>}
    </Pressable>
    {expanded && <View style={{ borderTopWidth: 1, borderTopColor: colors.border }}>
      {group.entries.slice(0, limit).map(entry => <RatePlan key={entry.key} now={now} entry={entry} requestedCurrency={requestedCurrency} onReview={onReview} failed={reviewError === entry.key} onRefresh={onRefresh} onEditSearch={onEditSearch}/>)}
      <View style={{ padding: 16, gap: 10 }}><Txt kind="small">{copy.rateCount(Math.min(limit, group.entries.length), group.entries.length)}</Txt>
        {limit < group.entries.length && <Button variant="secondary" title={copy.moreRates(group.entries.length - limit)} onPress={() => setLimit(value => value + 4)}/>}
      </View>
    </View>}
  </View>;
}

function HotelContents({ hotel, hid, criteria, onRefresh }: { hotel: HotelDetails; hid: number; criteria: SearchCriteria; onRefresh: () => void }) {
  const { language, t } = useLanguage(); const copy = roomChoiceCopy(language);
  const { saved, toggleSaved, savedReady, savedErrorKind, retrySaved, setReviewDraft } = useAppState();
  const { status: authStatus, sessionRevision } = useAuth();
  const router = useRouter(); const { width, fontScale } = useWindowDimensions();
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const sections = useRef<Record<Section, React.ComponentRef<typeof View> | null>>({ rooms: null, about: null, amenities: null, policies: null });
  const jumpRevision = useRef(0);
  const [query, setQuery] = useState(''); const [meal, setMeal] = useState<MealFacet>({ kind: 'all' });
  const [sort, setSort] = useState<RoomChoiceSort>('original'); const [groupLimit, setGroupLimit] = useState(6);
  const [reviewError, setReviewError] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const cancellations = useMemo(() => hotel.offers.map(offer => offer.cancellation), [hotel.offers]);
  const now = useCancellationClock(cancellations);
  const model = useMemo(() => buildRoomChoices(hotel.offers, { currency: criteria.currency, query, meal, sort, freeOnly, now }),
    [hotel.offers, criteria.currency, query, meal, sort, freeOnly, now]);
  useEffect(() => () => { jumpRevision.current++; }, []);
  const jump = (section: Section) => {
    Keyboard.dismiss(); const revision = ++jumpRevision.current;
    const target = sections.current[section], content = scroll.current?.getInnerViewRef();
    if (!target || !content) return;
    // Expanded rate plans, filters and text sizing can move a section without
    // resizing that section. Measure its current content-relative position.
    target.measureLayout(content, (_x, y) => {
      if (revision !== jumpRevision.current || sections.current[section] !== target
        || scroll.current?.getInnerViewRef() !== content || !Number.isFinite(y)) return;
      scroll.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
    }, () => {});
  };
  const clear = () => { setQuery(''); setMeal({ kind: 'all' }); setFreeOnly(false); };
  const review = (entry: RoomChoiceEntry) => {
    setReviewError('');
    if (authSession.getRevision() !== sessionRevision || authSession.getSnapshot().status !== authStatus) { setReviewError(entry.key); return; }
    // Pass the exact source offer. Display grouping/filtering never rebuilds or
    // substitutes a hash, price, tax, policy or signed capability.
    const accepted = setReviewDraft({ hid, hotelName: hotel.name, hotelAddress: hotel.address,
      hotelImage: hotel.images[0], criteria, offer: entry.offer, language });
    if (accepted) router.push('/review'); else setReviewError(entry.key);
  };
  const filtered = Boolean(query.trim() || meal.kind !== 'all' || freeOnly);
  const savedHere = saved.includes(hid);
  const guestCount = criteria.guests.reduce((sum, room) => sum + room.adults + room.children.length, 0);
  const narrowDock = width < 380 || fontScale > 1.4;
  return <>
    <ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={ui.page} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}>
      <View style={{ gap: 14 }}>
        <Row style={{ alignItems: 'flex-start', gap: 10 }}><View style={{ flex: 1, gap: 4 }}>
          <Txt accessibilityRole="header" kind="title">{hotel.name}</Txt>
          {hotel.address && <Txt kind="small">{hotel.address}</Txt>}
          {Number.isInteger(hotel.stars) && hotel.stars! >= 1 && hotel.stars! <= 5 && <Txt kind="small">{copy.stars(hotel.stars!)}</Txt>}
        </View><Pressable accessibilityRole="button" accessibilityLabel={t(savedHere ? 'removeSaved' : 'saveStay')} aria-pressed={savedHere}
          accessibilityState={{ disabled: !savedReady, selected: savedHere }} disabled={!savedReady} onPress={() => toggleSaved(hid)}
          style={[styles.save, { opacity: savedReady ? 1 : .5 }]}><Txt accessible={false} style={{ fontSize: 25, color: colors.blueStrong }}>{savedHere ? '♥' : '♡'}</Txt></Pressable></Row>
        {savedErrorKind && <View style={ui.card}><Txt accessibilityRole="alert">{t(savedErrorKind === 'load' ? 'savedError' : 'savedSaveFailed')}</Txt>
        <Button variant="quiet" title={t('retry')} onPress={() => void retrySaved()}/></View>}
      <HotelGallery images={hotel.images} name={hotel.name}/>
        <View style={styles.stay}><Txt kind="label" style={{ writingDirection: 'ltr' }}>{criteria.checkin} → {criteria.checkout}</Txt>
          <Txt kind="small">{copy.staySummary(guestCount, criteria.guests.length)}</Txt></View>
        <Button title={`${copy.chooseRooms} · ${copy.ratePlans(hotel.offers.length)}`} onPress={() => jump('rooms')}/>
        <Row style={{ flexWrap: 'wrap', gap: 8 }}>{(['about', 'amenities', 'policies'] as Section[]).map(section => <ChoiceChip key={section} label={copy[section]} onPress={() => jump(section)}/>)}</Row>
      </View>

      <View ref={value => { sections.current.rooms = value; }} collapsable={false} style={{ gap: 16 }}>
        <View style={{ gap: 6 }}><Txt accessibilityRole="header" kind="heading">{copy.roomsTitle}</Txt><Txt kind="small">{copy.roomHint}</Txt></View>
        {hotel.offers.length === 0 ? <StatePanel title={t('noOffers')}/> : <>
          <View style={[ui.card, { padding: 16, gap: 14 }]}>
            <Field label={copy.roomSearch} placeholder={copy.roomSearchHint} value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" returnKeyType="search"/>
            <View style={{ gap: 8 }}><Txt kind="label">{copy.meals}</Txt>
              <Row style={{ flexWrap: 'wrap', gap: 8 }}>
                <ChoiceChip label={copy.allMeals} selected={meal.kind === 'all'} onPress={() => setMeal({ kind: 'all' })}/>
                {model.meals.values.map(value => <ChoiceChip key={value} label={roomMealLabel(value, t('roomOnly'), copy.missingMeal, language)} selected={meal.kind === 'value' && meal.value === value} onPress={() => setMeal({ kind: 'value', value })}/>)}
                {model.meals.hasMissing && <ChoiceChip label={copy.missingMeal} selected={meal.kind === 'missing'} onPress={() => setMeal({ kind: 'missing' })}/>}
              </Row>
            </View>
            <FreeCancellationFilter checked={freeOnly} onChange={setFreeOnly}/>
            <Row style={{ flexWrap: 'wrap', gap: 8 }}><ChoiceChip label={copy.original} selected={sort === 'original'} onPress={() => setSort('original')}/>
              <ChoiceChip label={copy.lowest(criteria.currency)} selected={sort === 'price'} onPress={() => setSort('price')}/></Row>
            <Txt accessibilityLiveRegion="polite" kind="small">{copy.count(model.matchingOffers, model.totalOffers, model.groups.length)}</Txt>
            {filtered && <Button variant="quiet" title={copy.clear} onPress={clear}/>}
          </View>
          {model.groups.length === 0 ? <View style={{ gap: 12 }}><StatePanel title={copy.noMatch} body={copy.noMatchBody}/><Button variant="secondary" title={copy.clear} onPress={clear}/></View>
            : <>{model.groups.slice(0, groupLimit).map(group => <RoomGroup key={group.key} group={group} now={now} requestedCurrency={criteria.currency} onReview={review} reviewError={reviewError} onRefresh={onRefresh} onEditSearch={() => router.push('/')}/>)}
              <Txt kind="small">{copy.groupCount(Math.min(groupLimit, model.groups.length), model.groups.length)}</Txt>
              {groupLimit < model.groups.length && <Button variant="secondary" title={copy.moreGroups(model.groups.length - groupLimit)} onPress={() => setGroupLimit(value => value + 6)}/>}</>}
        </>}
      </View>

      <View ref={value => { sections.current.about = value; }} collapsable={false} style={ui.card}>
        <Txt accessibilityRole="header" kind="heading">{copy.about}</Txt><Txt kind="small">{copy.propertyNote}</Txt>
        {hotel.description.length ? hotel.description.map((paragraph, index) => <Txt key={index}>{paragraph}</Txt>) : <Txt kind="small">{t('noDescription')}</Txt>}
        <Button variant="quiet" title={copy.chooseRooms} onPress={() => jump('rooms')}/>
      </View>
      <View ref={value => { sections.current.amenities = value; }} collapsable={false} style={ui.card}>
        <Txt accessibilityRole="header" kind="heading">{copy.amenities}</Txt>
        {hotel.amenities.length ? hotel.amenities.map((amenity, index) => <Txt key={`${amenity}-${index}`}>· {amenity}</Txt>) : <Txt kind="small">{t('noAmenities')}</Txt>}
      </View>
      <View ref={value => { sections.current.policies = value; }} collapsable={false} style={{ gap: 14 }}>
        {Object.keys(hotel.policies).length || hotel.policyExtraInfo ? <Policies source={hotel.policies} extra={hotel.policyExtraInfo}/>
          : <View style={ui.card}><Txt accessibilityRole="header" kind="heading">{copy.policies}</Txt><Txt kind="small">{copy.policyUnknown}</Txt></View>}
        <Button variant="secondary" title={copy.chooseRooms} onPress={() => jump('rooms')}/>
      </View>
    </ScrollView>
    {/* A flex sibling, never an overlay: safe-area padding and large text reduce
        the scroll viewport instead of hiding a focused rate or room control. */}
    <View style={styles.dock}><View style={[styles.dockInner, { flexDirection: narrowDock ? 'column' : 'row', alignItems: narrowDock ? 'stretch' : 'center' }]}>
      <View style={{ flex: narrowDock ? undefined : 1, gap: 1 }}><Txt kind="small">{model.fromPrice ? `${copy.from} · ${t('priceForStay')}` : copy.noComparablePrice(criteria.currency)}</Txt>
        {model.fromPrice && <MoneyText money={model.fromPrice}/>}<Txt kind="small">{copy.notReserved}</Txt></View>
      <View style={{ flex: narrowDock ? undefined : 1 }}><Button title={copy.chooseRooms} onPress={() => jump('rooms')}/></View>
    </View></View>
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
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}><BrandHeader back/><EnvironmentBanner/>
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
  gallery: { borderRadius: 20, overflow: 'hidden', backgroundColor: colors.softBlue },
  photoControl: { position: 'absolute', top: '35%', minWidth: 48, minHeight: 48, paddingHorizontal: 14,
    borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  photoArrow: { fontSize: 30, lineHeight: 40, color: colors.navy, fontFamily: fonts.bold },
  photoCount: { position: 'absolute', bottom: 10, right: 10, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  stay: { borderRadius: 16, padding: 13, backgroundColor: colors.softBlue, gap: 3 },
  roomThumb: { width: 86, borderRadius: 13, overflow: 'hidden' },
  ratePlan: { padding: 18, gap: 15, borderBottomWidth: 1, borderBottomColor: colors.border },
  ratePrice: { borderRadius: 15, backgroundColor: colors.softBlue, padding: 14, gap: 4 },
  dock: { borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  dockInner: { width: '100%', maxWidth: 880, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12 },
});
