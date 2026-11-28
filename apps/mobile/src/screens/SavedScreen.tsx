import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { validateSearchCriteria } from '../api';
import { hotelId } from '../api/validation';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, elevation, radius, space, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import { Badge, Button, Icon, IconButton, Photo, Row, StatePanel, TextLink, Txt } from '../components/Primitives';
import { StarRating } from '../components/HotelCard';
import { StaySummaryBar } from '../components/StayFields';
import { shortAddress } from '../components/format';
import { useSavedHotelCards, type SavedHotelCard } from '../components/useSavedHotelCards';
import { SAVED_HOTELS_LIMIT } from '../components/savedHotelsModel';
import { savedCopy } from './savedCopy';

type RemovedStay = { hid: number; index: number; name: string; scope: string };
const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);

/**
 * A saved hotel in the same shape as a search result: photo, stars, name and area. The whole card
 * opens the rooms once stay details are set; removing is a separate button on the card's corner.
 * Internal hotel identifiers are never shown.
 */
function SavedCard({ hid, card, canRemove, canViewRooms, remove, viewRooms }: {
  hid: number; card?: SavedHotelCard; canRemove: boolean; canViewRooms: boolean; remove: () => void; viewRooms: () => void;
}) {
  const { language, rtl } = useLanguage();
  const ar = language === 'ar';
  const copy = savedCopy(language);
  const name = card?.name || copy.fallback(hid);
  const stars = typeof card?.stars === 'number' && Number.isInteger(card.stars) && card.stars >= 1 && card.stars <= 5 ? card.stars : undefined;
  const place = shortAddress(card?.address, language);
  const unsupported = hotelId(hid) === null;
  return (
    <View testID={`saved-${hid}`} style={styles.card}>
      <Pressable testID={`saved-open-${hid}`} accessibilityRole="button" disabled={!canViewRooms} onPress={viewRooms}
        accessibilityLabel={canViewRooms ? `${copy.viewRooms}: ${name}` : name}
        style={state => [{ flexDirection: rtl ? 'row-reverse' : 'row', alignItems: 'stretch' }, (state.pressed || hovered(state)) && canViewRooms && { backgroundColor: color.bgMuted }]}>
        <View style={styles.thumb}>
          {card ? <Photo uri={card.imageUrl} alternatives={card.images} label={name} height="100%" thumbnail/> : <Photo label={name} height="100%" thumbnail/>}
        </View>
        <View style={styles.details}>
          {stars !== undefined && <StarRating stars={stars} size={13}/>}
          <Txt kind="subheading" accessibilityRole="header" numberOfLines={2} style={{ fontSize: 16, lineHeight: ar ? 26 : 22 }}>{name}</Txt>
          {!!place && <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
            <View style={{ paddingTop: 2 }}><Icon name="pin" size={14} color={color.textSecondary}/></View>
            <Txt kind="caption" numberOfLines={1} accessibilityLabel={card?.address} style={{ flex: 1 }}>{place}</Txt></Row>}
          {unsupported && <Txt kind="caption" tone="warning">{copy.unsupported}</Txt>}
          <View style={{ flex: 1, minHeight: space.xs }}/>
          {canViewRooms ? <Row style={{ gap: space.xxs }}><Txt kind="label" tone="link">{copy.viewRooms}</Txt><Icon name="chevron" size={14} color={color.textLink}/></Row>
            : !unsupported && <Txt kind="caption">{copy.datesBody}</Txt>}
        </View>
      </Pressable>
      <View pointerEvents="box-none" style={[styles.remove, rtl ? { left: space.xs } : { right: space.xs }]}>
        <IconButton icon="trash" size={18} testID={`saved-remove-${hid}`} label={`${copy.remove}: ${name}`} disabled={!canRemove} onPress={remove}/>
      </View>
    </View>
  );
}

export default function SavedScreen() {
  const state = useAppState();
  const { language } = useLanguage();
  const { status, sessionRevision } = useAuth();
  const router = useRouter();
  const copy = savedCopy(language);
  const [limit, setLimit] = useState(10);
  const [lastRemoved, setLastRemoved] = useState<RemovedStay | null>(null);
  const scope = `${status}:${sessionRevision}`;
  // Retire the one-shot undo if another control already restored the hotel,
  // or the authenticated-session metadata boundary changed.
  if (lastRemoved && (lastRemoved.scope !== scope || state.saved.includes(lastRemoved.hid))) setLastRemoved(null);
  const undo = lastRemoved?.scope === scope && !state.saved.includes(lastRemoved.hid) ? lastRemoved : null;
  const visibleIds = useMemo(() => state.saved.slice(0, limit), [state.saved, limit]);
  const metadata = useSavedHotelCards(visibleIds, language, status, sessionRevision);
  const validExample = useMemo(() => state.saved.find(id => hotelId(id) !== null), [state.saved]);
  const criteria = state.criteria;
  const validStay = validExample !== undefined && criteria !== null && validateSearchCriteria({
    ...criteria, regionId: undefined, hids: [validExample],
  }).valid;
  const chooseDates = () => router.push('/saved-dates');
  const retryStorage = () => { void state.retrySaved(); };
  const loadError = state.savedErrorKind === 'load';
  const saveError = state.savedErrorKind === 'save';
  const failedDetails = visibleIds.some(id => hotelId(id) !== null && metadata.failed.has(id));
  const remove = (hid: number) => {
    const index = state.saved.indexOf(hid);
    if (!state.savedReady || index < 0) return;
    setLastRemoved({ hid, index, name: metadata.cards.get(hid)?.name || copy.fallback(hid), scope });
    state.removeSaved(hid);
  };
  const undoRemoval = () => {
    if (!undo || !state.savedReady || state.saved.length >= SAVED_HOTELS_LIMIT) return;
    state.restoreSaved(undo.hid, undo.index);
    setLastRemoved(current => current === undo ? null : current);
  };

  const header = (
    <View style={{ gap: space.md, paddingBottom: space.md }}>
      <View style={{ gap: space.xxs }}>
        <Row style={{ gap: space.sm }}>
          <Txt kind="heading" accessibilityRole="header" style={{ flexShrink: 1 }}>{copy.title}</Txt>
          {state.savedReady && state.saved.length > 0 && <View accessibilityLiveRegion="polite" accessibilityLabel={copy.count(state.saved.length)}><Badge tone="info" label={String(state.saved.length)}/></View>}
        </Row>
        <Txt kind="caption">{copy.device}</Txt>
      </View>
      {undo && (
        <Row style={styles.banner} accessibilityLiveRegion="polite">
          <Txt kind="small" tone="primary" style={{ flex: 1 }}>{copy.removed(undo.name)}</Txt>
          <Button compact title={copy.undo} variant="tonal" disabled={!state.savedReady || state.saved.length >= SAVED_HOTELS_LIMIT} onPress={undoRemoval} />
          {state.saved.length >= SAVED_HOTELS_LIMIT && <Txt kind="caption">{copy.undoFull}</Txt>}
        </Row>
      )}
      {state.saved.length > 0 && validExample !== undefined && (validStay && criteria ? (
        <View style={{ gap: space.sm }}>
          <StaySummaryBar compact testID="saved-stay" criteria={criteria} onEditDates={chooseDates} onEditGuests={chooseDates}/>
          <Button testID="saved-check-prices" icon="search" title={copy.checkPrices} disabled={!state.savedReady} onPress={() => router.push('/saved-offers')} />
        </View>
      ) : (
        <Row style={styles.banner}>
          <Txt kind="small" tone="primary" style={{ flex: 1 }}>{copy.datesBody}</Txt>
          <Button compact title={copy.chooseDates} icon="calendar" disabled={!state.savedReady} onPress={chooseDates} />
        </Row>
      ))}
      {state.savedPending && !saveError && <Txt kind="small" accessibilityLiveRegion="polite">{copy.saving}</Txt>}
      {state.saved.length > 0 && state.savedLoading && <Txt kind="small">{copy.loading}</Txt>}
      {state.saved.length > 0 && loadError && (
        <Row style={[styles.banner, { backgroundColor: color.warningBg }]}>
          <Txt accessibilityRole="alert" kind="small" tone="primary" style={{ flex: 1 }}>{copy.loadError}</Txt>
          <Button compact title={copy.retryLoad} variant="secondary" onPress={retryStorage} />
        </Row>
      )}
      {saveError && (
        <Row style={[styles.banner, { backgroundColor: color.warningBg }]}>
          <Txt accessibilityRole="alert" kind="small" tone="primary" style={{ flex: 1 }}>{copy.saveError}</Txt>
          <Button compact title={copy.retrySave} variant="secondary" onPress={retryStorage} />
        </Row>
      )}
      {state.saved.length > 0 && metadata.loading && <Txt kind="caption">{copy.loadingDetails}</Txt>}
      {state.saved.length > 0 && failedDetails && (
        <Row style={{ gap: space.sm, justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <Txt kind="small" style={{ flexShrink: 1 }}>{copy.detailsError}</Txt>
          <TextLink icon="refresh" title={copy.retryDetails} onPress={metadata.retry} />
        </Row>
      )}
    </View>
  );
  const empty = state.savedLoading ? <StatePanel title={copy.loading} busy />
    : loadError ? <View style={{ gap: 14 }}><StatePanel title={copy.loadError} body={copy.loadErrorBody} /><Button title={copy.retryLoad} variant="secondary" onPress={retryStorage} /></View>
      : <View style={{ gap: 14 }}>{!undo && <StatePanel testID="saved-empty" icon="saved" title={copy.empty} body={copy.emptyBody} />}<Button title={copy.findStay} onPress={() => router.navigate('/')} /></View>;

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <BrandHeader />
      <FlatList data={visibleIds} keyExtractor={id => String(id)} contentContainerStyle={ui.page}
        renderItem={({ item }) => <SavedCard hid={item} card={metadata.cards.get(item)} canRemove={state.savedReady}
          canViewRooms={state.savedReady && validStay && hotelId(item) !== null} remove={() => remove(item)}
          viewRooms={() => router.push({ pathname: '/hotel/[hid]', params: { hid: String(item) } })} />}
        ItemSeparatorComponent={() => <View style={{ height: space.md }} />}
        ListHeaderComponent={header} ListEmptyComponent={empty}
        initialNumToRender={10} maxToRenderPerBatch={10} windowSize={5}
        ListFooterComponent={limit < state.saved.length ? (
          <Button title={copy.more(Math.min(10, state.saved.length - limit))} variant="secondary" onPress={() => setLimit(value => value + 10)} />
        ) : undefined} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.borderCard, ...elevation.card },
  thumb: { width: 112, minHeight: 128, backgroundColor: color.photoPlaceholder },
  details: { flex: 1, minWidth: 0, paddingHorizontal: space.md, paddingVertical: space.sm, gap: space.xxs },
  remove: { position: 'absolute', bottom: space.xxs },
  banner: { flexWrap: 'wrap', alignItems: 'center', gap: space.sm, padding: space.md, borderRadius: radius.lg, backgroundColor: color.bgSelected },
});
