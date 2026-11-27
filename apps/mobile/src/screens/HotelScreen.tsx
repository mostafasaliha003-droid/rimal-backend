import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image as CachedImage } from 'expo-image';
import { Animated, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { api, authSession } from '../api';
import { useAuth } from '../auth';
import type { HotelDetails, SearchCriteria } from '../types';
import { useLanguage } from '../i18n';
import { color, elevation, layout, motion, radius, space, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import { useAppState } from '../components/AppState';
import ApiState from '../components/ApiState';
import { ActionBar, Button, Card, Chip, Field, Icon, IconButton, Row, Skeleton, StatePanel, Txt } from '../components/Primitives';
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
import { StarRating } from '../components/HotelCard';
import { StaySummaryBar, useStayEditor } from '../components/StayFields';
import { formatPrice, nightsBetween, occupancy, shortAddress, stayWords } from '../components/format';
import { useLayout, useReducedMotion } from '../components/motion';
import { useToast } from '../components/Toast';
import { useChargeMoney } from '../components/ChargeCurrency';
import { localizedBedding, localizedRoomName } from '../components/roomNameModel';
import { hotelPreview, type HotelPreview } from '../components/hotelPreview';
import GuestRatingBadge from '../components/GuestRatingBadge';
import { shownRating } from '../components/guestRatingModel';
import { useGuestRatings } from '../components/useGuestRatings';

type Section = 'rooms' | 'about';

/** The photo carried over from the result card, settling into place (a soft zoom and fade). */
function PreviewHero({ uri, name }: { uri: string; name: string }) {
  const reduced = useReducedMotion();
  const { width } = useWindowDimensions();
  const [settle] = useState(() => new Animated.Value(reduced ? 1 : 0));
  useEffect(() => {
    if (reduced) return;
    Animated.timing(settle, { toValue: 1, duration: 360, easing: motion.emphasized, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [settle, reduced]);
  const height = Math.min(300, Math.max(168, width * .46));
  return <View style={{ height, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.photoPlaceholder }}>
    {/* The card already cached this photo, so it is on screen in the first frame. */}
    <Animated.View style={{ width: '100%', height: '100%',
      opacity: settle.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
      transform: [{ scale: settle.interpolate({ inputRange: [0, 1], outputRange: [1.06, 1] }) }] }}>
      <CachedImage accessibilityLabel={name} source={{ uri }} contentFit="cover" cachePolicy="memory-disk" style={{ width: '100%', height: '100%' }}/>
    </Animated.View>
  </View>;
}

function HotelSkeleton({ preview }: { preview?: HotelPreview | null }) {
  return <View style={{ gap: space.lg }} accessibilityLabel="loading">
    {preview?.photo ? <PreviewHero uri={preview.photo} name={preview.name}/> : <Skeleton height={220} rounded={radius.lg}/>}
    {preview ? <View style={{ gap: space.xxs }}>
      {!!preview.stars && <StarRating stars={preview.stars} size={13}/>}
      <Txt kind="heading" numberOfLines={2}>{preview.name}</Txt>
      {!!preview.address && <Txt kind="caption" numberOfLines={1}>{preview.address}</Txt>}
    </View> : <View style={{ gap: space.sm }}><Skeleton width="25%" height={12}/><Skeleton width="80%" height={24}/><Skeleton width="55%" height={14}/></View>}
    <Skeleton height={64} rounded={radius.lg}/>
    {[0, 1].map(index => <Card key={index} style={{ gap: space.sm }}><Skeleton width="50%" height={18}/><Skeleton height={90} rounded={radius.md}/><Skeleton width="35%" height={22} style={{ alignSelf: 'flex-end' }}/></Card>)}
  </View>;
}

function RoomGroup({ now, group, criteria, onReview, reviewError, onRefresh, onEditSearch, selected, onToggle, showCompare, chosenKey, choose }: {
  now: number; group: RoomChoiceGroup; criteria: SearchCriteria; onReview: (entry: RoomChoiceEntry) => void; reviewError: string;
  onRefresh: () => void; onEditSearch: () => void; selected: RoomChoiceEntry[]; onToggle: (entry: RoomChoiceEntry) => void; showCompare: boolean;
  chosenKey: string | null; choose: (key: string) => void;
}) {
  const { language } = useLanguage(); const short = rateCopy(language);
  const ar = language === 'ar';
  const first = group.lowestReviewable || group.entries[0], multiple = group.entries.length > 1;
  const active = group.entries.find(entry => entry.key === chosenKey) || first;
  const options = multiple ? [first, ...group.entries.filter(entry => entry.key !== first.key)] : group.entries;
  const shownName = localizedRoomName(group.name, language);
  const parts = shownName.match(/^(.+?)\s+\(([^()]+)\)$/);
  const title = parts?.[1] ?? shownName;
  const words = stayWords(language), count = occupancy(criteria.guests);
  const after = stayWords(language, { genitive: true });
  const nights = nightsBetween(criteria.checkin, criteria.checkout);
  const bedding = group.entries.find(entry => entry.offer.bedding)?.offer.bedding;
  const stayCaption = nights ? (ar ? `الإجمالي لـ ${after.nights(nights)}` : `Total for ${words.nights(nights)}`) : (ar ? 'الإجمالي' : 'Total');
  const variant = parts?.[2] && !bedding ? parts[2] : null; // otherwise the bed line below states it
  return <Card padded={false} style={{ overflow: 'hidden', gap: 0, borderRadius: 16 }}>
    <View testID={`room-group-header-${group.entries[0].index + 1}`} style={styles.roomHeader}>
      {active.offer.images.length > 0 && <HotelGallery key={active.key} images={active.offer.images} name={active.offer.name} room/>}
      <View style={{ gap: space.xxs }}>
        <Txt accessibilityRole="header" accessibilityLabel={shownName} kind="subheading">{title}</Txt>
        {variant && <Txt kind="small" tone="primary">{variant}</Txt>}
        <Row style={{ gap: space.md, flexWrap: 'wrap', rowGap: space.xxs }}>
          {bedding && <Row style={{ gap: space.xs }}><Icon name="bed" size={16} color={color.textSecondary}/><Txt kind="small" tone="primary">{localizedBedding(bedding, language)}</Txt></Row>}
          <Row style={{ gap: space.xs }}><Icon name="users" size={16} color={color.textSecondary}/>
            <Txt kind="small" tone="primary">{ar ? `لـ ${after.guests(count.guests)} في ${after.rooms(count.rooms)}` : `For ${words.guests(count.guests)} in ${words.rooms(count.rooms)}`}</Txt></Row>
        </Row>
        {multiple && <Txt kind="caption">{short.plans(group.entries.length)}{group.freeNowCount ? ` · ${ar ? `${group.freeNowCount} منها بإلغاء مجاني` : `${group.freeNowCount} with free cancellation`}` : ''}</Txt>}
      </View>
    </View>
    <RoomOfferPicker entries={options} selected={active} preferredKey={group.lowestReviewable?.key} groupName={group.name} groupBedding={bedding} stayCaption={stayCaption}
      currency={criteria.currency} now={now} comparison={selected} reviewError={reviewError} showCompare={showCompare}
      onSelect={entry => choose(entry.key)} onToggle={onToggle} onReview={onReview} onRefresh={onRefresh} onEditSearch={onEditSearch}/>
  </Card>;
}

function HotelContents({ hotel, hid, criteria, onRefresh }: { hotel: HotelDetails; hid: number; criteria: SearchCriteria; onRefresh: () => void }) {
  const charge = useChargeMoney();
  const { language, t } = useLanguage(); const copy = roomChoiceCopy(language);
  const ar = language === 'ar';
  const { saved, toggleSaved, savedReady, savedErrorKind, retrySaved, setReviewDraft } = useAppState();
  const { status: authStatus, sessionRevision } = useAuth();
  const router = useRouter(); const { gutter, desktop } = useLayout();
  const toast = useToast(); const reduced = useReducedMotion();
  const stayEditor = useStayEditor();
  const ratingIds = useMemo(() => [hotel.hid], [hotel.hid]);
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
  const chooseRooms = () => { setSection('rooms'); scroller.current?.scrollTo({ y: tabTop.current, animated: !reduced }); };
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
  const freeCount = useMemo(() => buildRoomChoices(hotel.offers, { currency: criteria.currency, freeOnly: true, now }).matchingOffers, [hotel.offers, criteria.currency, now]);
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
  const save = () => {
    const adding = !savedHere; toggleSaved(hid);
    toast(adding ? { message: ar ? 'حُفظ الفندق في المفضلة' : 'Hotel saved', icon: 'saved', action: { label: ar ? 'عرض المفضلة' : 'View saved', onPress: () => router.navigate('/saved') } }
      : { message: ar ? 'أُزيل من المفضلة' : 'Removed from saved', icon: 'info', action: { label: ar ? 'تراجع' : 'Undo', onPress: () => toggleSaved(hid) } });
  };
  const words = stayWords(language), count = occupancy(criteria.guests), nights = nightsBetween(criteria.checkin, criteria.checkout);
  const stayCaption = [nights ? words.nights(nights) : '', words.rooms(count.rooms), words.guests(count.guests)].filter(Boolean).join(' · ');
  const lowest = formatPrice(charge(model.fromPrice));
  const [pulse] = useState(() => new Animated.Value(1));
  useEffect(() => {
    // A brief nudge on the result count when filters change it, unless motion is reduced.
    if (reduced) return;
    pulse.setValue(0.6);
    Animated.timing(pulse, { toValue: 1, duration: 260, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [model.matchingOffers, pulse, reduced]);

  const hotelRating = useGuestRatings(ratingIds, language).get(hotel.hid);
  return <>
    <ScrollView ref={scroller} stickyHeaderIndices={[1]} scrollEventThrottle={32}
      onScroll={event => { position.current = event.nativeEvent.contentOffset.y; }}
      style={{ flex: 1 }} contentContainerStyle={[styles.page, { paddingHorizontal: gutter, maxWidth: desktop ? 1040 : layout.maxReading + 160 }]}
      keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'}>
      <View style={{ gap: space.md }} onLayout={({ nativeEvent: { layout: frame } }) => { tabTop.current = frame.y + frame.height + space.md; }}>
        <HotelGallery images={hotel.images} name={hotel.name}/>
        <Row style={{ alignItems: 'flex-start', gap: space.md }}>
          <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
            <Row style={{ gap: space.sm, flexWrap: 'wrap' }}><StarRating stars={hotel.stars}/>
              <Pressable testID="hotel-reviews-link" accessibilityRole="link" accessibilityHint={ar ? 'يفتح تقييمات الضيوف' : 'Opens guest reviews'}
                onPress={() => router.push({ pathname: '/reviews/[hid]', params: { hid: String(hotel.hid) } })} hitSlop={{ top: 10, bottom: 10 }}>
                <Row style={{ gap: space.xs }}>{shownRating(hotelRating) ? <GuestRatingBadge rating={hotelRating} showCount testID="hotel-rating"/> : null}
                  <Txt kind="caption" tone="link">{shownRating(hotelRating) ? (ar ? 'التقييمات' : 'Reviews') : (ar ? 'تقييمات الضيوف' : 'Guest reviews')}</Txt></Row>
              </Pressable></Row>
            <Txt accessibilityRole="header" accessibilityLabel={hotel.name} kind="heading" testID="hotel-name" numberOfLines={2} style={{ fontSize: 19, lineHeight: ar ? 30 : 26 }}>{hotel.name}</Txt>
            {hotel.address && <Pressable testID="hotel-location-link" accessibilityRole="button" accessibilityHint={ar ? 'يعرض موقع الفندق على الخريطة' : 'Shows the hotel location on the map'}
              onPress={showLocation} style={{ minHeight: 40, justifyContent: 'center' }}>
              <Row style={{ gap: space.xs, alignItems: 'center' }}><Icon name="pin" size={16} color={color.interactiveStrong}/>
                <Txt kind="small" tone="link" numberOfLines={1} accessibilityLabel={hotel.address} style={{ flex: 1 }}>{shortAddress(hotel.address, language)}</Txt>
                <Txt kind="label" tone="link">{ar ? 'الخريطة' : 'Map'}</Txt></Row>
            </Pressable>}
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t(savedHere ? 'removeSaved' : 'saveStay')} aria-pressed={savedHere}
            accessibilityState={{ disabled: !savedReady, selected: savedHere }} disabled={!savedReady} onPress={save}
            hitSlop={4} style={[styles.save, elevation.card, { opacity: savedReady ? 1 : .5 }]}>
            <Icon name="saved" filled={savedHere} size={22} color={savedHere ? color.danger : color.textBrand}/></Pressable>
        </Row>
        {savedErrorKind && <Card><Txt accessibilityRole="alert">{t(savedErrorKind === 'load' ? 'savedError' : 'savedSaveFailed')}</Txt>
          <Button variant="quiet" title={t('retry')} onPress={() => void retrySaved()}/></Card>}
        <StaySummaryBar compact testID="hotel-stay" criteria={criteria} onEditDates={() => stayEditor.editDates()} onEditGuests={stayEditor.editGuests}/>
      </View>
      <View accessibilityRole="tablist" style={styles.tabBar}>
        <Row style={styles.tabs}>
          {(['rooms', 'about'] as const).map(key => <Pressable key={key} accessibilityRole="tab" aria-selected={section === key} accessibilityState={{ selected: section === key }}
            testID={`hotel-tab-${key}`} onPress={() => showSection(key)} style={[styles.tab, section === key && styles.activeTab]}>
            <Row style={{ justifyContent: 'center', gap: space.xs }}><Icon name={key === 'rooms' ? 'bed' : 'info'} size={18} color={section === key ? color.onActionPrimary : color.textBrand}/>
              <Txt kind="label" style={{ textAlign: 'center', color: section === key ? color.onActionPrimary : color.textBrand }}>{key === 'rooms' ? copy.rooms : short.overview}</Txt></Row>
          </Pressable>)}
        </Row>
      </View>
      {section === 'rooms' ? <View style={{ gap: space.sm + 2 }}>
        <Row style={{ gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
          <Txt accessibilityRole="header" kind="subheading" style={{ flex: 1 }}>{copy.roomsTitle}</Txt>
          {hotel.offers.length > 0 && <Animated.View style={{ opacity: pulse }}><Txt testID="room-match-count" accessibilityLiveRegion="polite" kind="label" tone="link">{short.plans(model.matchingOffers)}</Txt></Animated.View>}
          {hotel.offers.length > 0 && <IconButton testID="room-filters-toggle" icon="filter" variant="outline" size={18} label={short.filters}
            selected={filtersOpen || query.trim() !== '' || sort !== 'original'} onPress={() => setFiltersOpen(value => !value)}/>}
        </Row>
        {hotel.offers.length > 0 && <Row style={{ flexWrap: 'wrap', gap: space.xs }}>
          {freeCount > 0 && <Chip size="sm" testID="room-free-only" role="checkbox" selected={freeOnly} icon="checkCircle"
            label={ar ? `إلغاء مجاني (${freeCount})` : `Free cancellation (${freeCount})`} accessibilityLabel={copy.freeOnly} onPress={() => setFreeOnly(value => !value)}/>}
          {model.totalGroups > 1 && <RoomTypePicker groups={model.roomTypes} value={roomType} onChange={setRoomType}/>}
          <MealPlanPicker value={meal} options={model.mealOptions} onChange={setMeal}/>
        </Row>}
        {hotel.offers.length === 0 ? <StatePanel icon="bed" title={t('noOffers')}
          body={ar ? 'قد تكون الغرف نفدت لهذه التواريخ. جرّب تواريخ أخرى؛ نحتفظ بالضيوف.' : 'Rooms may be sold out for these dates. Try other dates; your guests are kept.'}>
          <Button icon="calendar" title={ar ? 'غيّر التواريخ' : 'Change dates'} onPress={() => stayEditor.editDates()}/></StatePanel> : <>
          {filtersOpen && <Card style={{ gap: space.md }}>
            <Field label={copy.roomSearch} placeholder={copy.roomSearchHint} value={query} onChangeText={setQuery} autoCorrect={false} autoCapitalize="none" returnKeyType="search"/>
            <Row style={{ flexWrap: 'wrap', gap: space.sm }} accessibilityRole="radiogroup">
              <Chip role="radio" label={copy.original} selected={sort === 'original'} onPress={() => setSort('original')}/>
              <Chip role="radio" label={copy.lowest(criteria.currency)} selected={sort === 'price'} onPress={() => setSort('price')}/></Row>
            <Txt accessibilityLiveRegion="polite" kind="caption">{copy.count(model.matchingOffers, model.totalOffers, model.groups.length)}</Txt>
            {filtered && <Button variant="quiet" title={copy.clear} onPress={clear}/>}
          </Card>}
          {model.groups.length === 0 ? <View style={{ gap: space.md }}><StatePanel icon="filter" title={copy.noMatch} body={copy.noMatchBody}/>
            {freeOnly && <Button variant="secondary" icon="close" title={ar ? 'إظهار العروض غير القابلة للإلغاء مجاناً أيضاً' : 'Also show rates without free cancellation'} onPress={() => setFreeOnly(false)}/>}
            <Button variant="quiet" title={copy.clear} onPress={clear}/></View>
            : <>{model.groups.slice(0, groupLimit).map(group => <RoomGroup key={group.key} group={group} now={now} selected={selected} criteria={criteria}
              chosenKey={chosenByRoom[group.key] ?? null} choose={key => setChosenByRoom(previous => ({ ...previous, [group.key]: key }))}
              showCompare={model.totalOffers > 1} onToggle={toggleComparison}
              onReview={review} reviewError={reviewError} onRefresh={onRefresh} onEditSearch={() => router.push('/')}/>)}
              {groupLimit < model.groups.length && <Button variant="secondary" title={copy.moreGroups(model.groups.length - groupLimit)} onPress={() => setGroupLimit(value => value + 6)}/>}</>}
        </>}
      </View> : <HotelAbout key={guideEntry.visit} hotel={hotel} criteria={criteria}/>}
    </ScrollView>
    {selected.length > 0 && section === 'rooms' ? <View style={[styles.dock, elevation.raised]}><Row style={[styles.dockInner, { maxWidth: desktop ? 1040 : layout.maxReading + 160 }]}>
      <View style={{ flex: 1, minWidth: 0 }}><Txt kind="label" accessibilityLiveRegion="polite">{short.compareCount(selected.length)}</Txt>
        {selected.length === 1 && <Txt kind="caption">{short.selectAnother}</Txt>}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={short.clear} onPress={() => setSelected([])} style={styles.clearCompare}><Icon name="close" size={18}/></Pressable>
      {selected.length === 2 && <View testID="compare-rates-open"><Button compact icon="compare" title={short.compareTitle} onPress={() => setComparisonOpen(true)}/></View>}
    </Row></View> : hotel.offers.length > 0 && (lowest
      ? <ActionBar testID="hotel-price-bar" maxWidth={desktop ? 1040 : layout.maxReading + 160} caption={ar ? 'سعر الأعضاء · ابتداءً من' : 'Member rate · from'}
        amount={lowest} amountTestID="hotel-from-price" note={stayCaption}>
        <Button testID="hotel-choose-room" icon="bed" title={copy.chooseRooms} onPress={chooseRooms}/></ActionBar>
      : <ActionBar testID="hotel-price-bar" maxWidth={desktop ? 1040 : layout.maxReading + 160} note={copy.noComparablePrice(criteria.currency)}>
        <Button testID="hotel-choose-room" icon="bed" title={copy.chooseRooms} onPress={chooseRooms}/></ActionBar>)}
    <RoomComparison visible={comparisonOpen} entries={selected} now={now} currency={criteria.currency} onClose={() => setComparisonOpen(false)} onReview={review}/>
    {stayEditor.element}
  </>;
}

export default function HotelScreen() {
  const { hid: parameter } = useLocalSearchParams<{ hid?: string | string[] }>();
  const hid = roomHotelId(parameter); const { criteria } = useAppState(); const { language, t } = useLanguage();
  const { user, status: authStatus, sessionRevision } = useAuth(); const router = useRouter(); const copy = roomChoiceCopy(language);
  const { gutter } = useLayout();
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
  const page = [ui.page, { paddingHorizontal: gutter }];
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}><BrandHeader back/>
    {hid === null ? <ScrollView contentContainerStyle={page}><StatePanel icon="alertCircle" title={copy.invalidHotel} body={copy.invalidHotelBody}/><Button title={t('search')} onPress={() => router.replace('/')}/></ScrollView>
      : !criteria ? <ScrollView contentContainerStyle={page}><StatePanel icon="calendar" title={t('datesRequired')} body={t('datesRequiredBody')}/><Button title={t('search')} onPress={() => router.push('/')}/></ScrollView>
        : loading ? <ScrollView contentContainerStyle={page}><Txt testID="brand-wait-hotel" kind="subheading" accessibilityRole="progressbar" accessibilityLiveRegion="polite" aria-live="polite">
          {language === 'ar' ? 'نحضّر الغرف وشروط الإقامة…' : 'Loading rooms and stay terms…'}</Txt><HotelSkeleton preview={hotelPreview(hid)}/></ScrollView>
          : error ? <ScrollView contentContainerStyle={page}><ApiState error={error} retry={refreshHotel}/></ScrollView>
            : hotel ? <HotelContents key={requestKey} hotel={hotel} hid={hid} criteria={criteria} onRefresh={refreshHotel}/>
              : <ScrollView contentContainerStyle={page}><StatePanel icon="bed" title={t('noOffers')} retry={refreshHotel}/></ScrollView>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  page: { width: '100%', alignSelf: 'center', paddingTop: space.md, paddingBottom: space.xxxl, gap: space.lg },
  save: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgSurface },
  tabBar: { backgroundColor: color.bgCanvas, paddingVertical: space.xs },
  tabs: { backgroundColor: color.bgField, padding: space.xxs, borderRadius: radius.md, gap: space.xxs },
  tab: { flex: 1, minWidth: 0, minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm, borderRadius: radius.sm },
  activeTab: { backgroundColor: color.actionPrimary },
  roomHeader: { gap: space.sm, padding: space.md, backgroundColor: color.bgSurface },
  clearCompare: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  dock: { borderTopWidth: 1, borderTopColor: color.border, backgroundColor: color.bgSurface },
  dockInner: { width: '100%', alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.md },
});
