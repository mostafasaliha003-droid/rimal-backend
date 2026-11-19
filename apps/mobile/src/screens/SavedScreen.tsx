import React, { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { validateSearchCriteria } from '../api';
import { hotelId } from '../api/validation';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from '../components/AppState';
import BrandHeader from '../components/BrandHeader';
import { Button, Photo, Row, StatePanel, Txt } from '../components/Primitives';
import { formatDay, guestLine, nightsBetween, stayWords } from '../components/format';
import { useSavedHotelCards, type SavedHotelCard } from '../components/useSavedHotelCards';
import { SAVED_HOTELS_LIMIT } from '../components/savedHotelsModel';
import { savedCopy } from './savedCopy';

type RemovedStay = { hid: number; index: number; name: string; scope: string };

function SavedCard({ hid, card, canRemove, canViewRooms, remove, viewRooms }: {
  hid: number; card?: SavedHotelCard; canRemove: boolean; canViewRooms: boolean; remove: () => void; viewRooms: () => void;
}) {
  const { language } = useLanguage();
  const copy = savedCopy(language);
  const name = card?.name || copy.fallback(hid);
  const stars = typeof card?.stars === 'number' && Number.isInteger(card.stars) && card.stars >= 1 && card.stars <= 5 ? card.stars : null;

  return (
    <View style={[ui.card, { gap: 12 }]}>
      <Row style={{ alignItems: 'flex-start' }}>
        {card && <View style={{ width: 80, borderRadius: 14, overflow: 'hidden' }}>
          <Photo uri={card.imageUrl} alternatives={card.images} label={name} height={80} thumbnail/>
        </View>}
        <View style={{ flex: 1, gap: 6 }}>
          <Txt kind="heading" accessibilityRole="header">{name}</Txt>
          {stars !== null && <Txt kind="small">{copy.starCount(stars)}</Txt>}
          {card?.address && <Txt kind="small" numberOfLines={2}>{card.address}</Txt>}
        </View>
      </Row>
      {hotelId(hid) === null && <Txt kind="small">{copy.unsupported}</Txt>}
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <View style={{ gap: 2 }}><Txt kind="small">{copy.hotelId}</Txt><Txt kind="small" selectable style={{ writingDirection: 'ltr' }}>{hid}</Txt></View>
        {canViewRooms && <Button compact title={copy.viewRooms} label={`${copy.viewRooms}: ${name}`} variant="secondary" onPress={viewRooms} />}
        <Button compact title={copy.remove} label={`${copy.remove}: ${name}`} variant="quiet"
          disabled={!canRemove} onPress={remove} />
      </Row>
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
    <View style={{ gap: 16, paddingBottom: 18 }}>
      <View style={{ gap: 6 }}>
        <Txt kind="title" accessibilityRole="header">{copy.title}</Txt>
        <Txt kind="small">{copy.device}</Txt>
        {state.savedReady && <Txt kind="label" accessibilityLiveRegion="polite">{copy.count(state.saved.length)}</Txt>}
      </View>
      {undo && (
        <View style={[ui.card, { backgroundColor: colors.softBlue, padding: 16 }]} accessibilityLiveRegion="polite">
          <Txt>{copy.removed(undo.name)}</Txt>
          <Button compact title={copy.undo} variant="secondary" disabled={!state.savedReady || state.saved.length >= SAVED_HOTELS_LIMIT} onPress={undoRemoval} />
          {state.saved.length >= SAVED_HOTELS_LIMIT && <Txt kind="small">{copy.undoFull}</Txt>}
        </View>
      )}
      {state.saved.length > 0 && validExample !== undefined && (
        <View style={[ui.card, { backgroundColor: colors.softBlue, padding: 16, gap: 10 }]}>
          {validStay && criteria ? (
            <>
              <Txt kind="label">{formatDay(criteria.checkin, language, { weekday: true })} – {formatDay(criteria.checkout, language, { weekday: true })}{nightsBetween(criteria.checkin, criteria.checkout) ? ` · ${stayWords(language).nights(nightsBetween(criteria.checkin, criteria.checkout)!)}` : ''}</Txt>
              <Txt kind="small">{guestLine(criteria.guests, language)} · {criteria.currency}</Txt>
              <Button title={copy.checkPrices} disabled={!state.savedReady} onPress={() => router.push('/saved-offers')} />
              <Button compact title={copy.editDates} variant="quiet" onPress={chooseDates} />
            </>
          ) : (
            <><Txt kind="small">{copy.datesBody}</Txt><Button title={copy.chooseDates} disabled={!state.savedReady} onPress={chooseDates} /></>
          )}
        </View>
      )}
      {state.savedPending && !saveError && <Txt kind="small" accessibilityLiveRegion="polite">{copy.saving}</Txt>}
      {state.saved.length > 0 && state.savedLoading && <Txt kind="small">{copy.loading}</Txt>}
      {state.saved.length > 0 && loadError && (
        <View style={[ui.card, { backgroundColor: colors.softGold, padding: 16 }]}>
          <Txt accessibilityRole="alert">{copy.loadError}</Txt>
          <Button compact title={copy.retryLoad} variant="secondary" onPress={retryStorage} />
        </View>
      )}
      {saveError && (
        <View style={[ui.card, { backgroundColor: colors.softGold, padding: 16 }]}>
          <Txt accessibilityRole="alert">{copy.saveError}</Txt>
          <Button compact title={copy.retrySave} variant="secondary" onPress={retryStorage} />
        </View>
      )}
      {state.saved.length > 0 && metadata.loading && <Txt kind="small">{copy.loadingDetails}</Txt>}
      {state.saved.length > 0 && failedDetails && (
        <View style={{ gap: 8 }}>
          <Txt kind="small">{copy.detailsError}</Txt>
          <Button compact title={copy.retryDetails} variant="quiet" onPress={metadata.retry} />
        </View>
      )}
    </View>
  );
  const empty = state.savedLoading ? <StatePanel title={copy.loading} busy />
    : loadError ? <View style={{ gap: 14 }}><StatePanel title={copy.loadError} body={copy.loadErrorBody} /><Button title={copy.retryLoad} variant="secondary" onPress={retryStorage} /></View>
      : <View style={{ gap: 14 }}>{!undo && <StatePanel title={copy.empty} body={copy.emptyBody} />}<Button title={copy.findStay} onPress={() => router.navigate('/')} /></View>;

  return (
    <SafeAreaView edges={['top']} style={ui.screen}>
      <BrandHeader />
      <FlatList data={visibleIds} keyExtractor={id => String(id)} contentContainerStyle={ui.page}
        renderItem={({ item }) => <SavedCard hid={item} card={metadata.cards.get(item)} canRemove={state.savedReady}
          canViewRooms={state.savedReady && validStay && hotelId(item) !== null} remove={() => remove(item)}
          viewRooms={() => router.push({ pathname: '/hotel/[hid]', params: { hid: String(item) } })} />}
        ItemSeparatorComponent={() => <View style={{ height: 14 }} />}
        ListHeaderComponent={header} ListEmptyComponent={empty}
        initialNumToRender={10} maxToRenderPerBatch={10} windowSize={5}
        ListFooterComponent={limit < state.saved.length ? (
          <Button title={copy.more(Math.min(10, state.saved.length - limit))} variant="secondary" onPress={() => setLimit(value => value + 10)} />
        ) : undefined} />
    </SafeAreaView>
  );
}
