import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { Money, RoomOffer } from '../types';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { Row, Txt } from './Primitives';
import { changedOfferSections, compareStayPrices, sourceStayMoney } from './offerChangeSummary';
import { offerChangesCopy, padStayPriceDifference } from './offerChangesCopy';
import Cancellation from './Cancellation';
import Taxes from './Taxes';
import { mealDescription, rateCopy, roomPaymentLabel } from './roomRateFacts';

// The internal renderer receives only model-whitelisted source/derived money.
// Derived differences can exceed the source field's 128-character length.
function ExactAmount({ money, large = false }: { money: Readonly<Money> | null; large?: boolean }) {
  const { language } = useLanguage();
  return money ? (
    <Txt style={{ fontFamily: fonts.bold, color: colors.navy, writingDirection: 'ltr',
      fontSize: large ? 26 : 20, lineHeight: large ? 36 : 29, flexShrink: 1 }}>
      {money.currency} {money.amount}
    </Txt>
  ) : <Txt kind="small">{offerChangesCopy(language).priceMissing}</Txt>;
}

/** Exact source price for the changed-offer room/dock, with no decimal rounding. */
export function ExactReviewMoney({ money, large = false }: { money: Money | null | undefined; large?: boolean }) {
  return <ExactAmount money={sourceStayMoney(money)} large={large} />;
}

export default function OfferChanges({ before, after }: { before: RoomOffer; after: RoomOffer }) {
  const { language } = useLanguage();
  const copy = offerChangesCopy(language);
  const changes = changedOfferSections(before, after);
  const price = compareStayPrices(before.price, after.price);
  const difference = price.difference ? padStayPriceDifference(price.difference, language) : null;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const nestedChanges = changes.filter(kind => kind === 'taxes' || kind === 'cancellation');
  const meal = (offer: RoomOffer) => mealDescription(offer, language, before.noChildMeal !== after.noChildMeal);

  return (
    <View testID="offer-changes" style={{ gap: 14 }}>
      <View testID="offer-change-price-summary" style={{ gap: 8 }}>
        <Row style={{ flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}>
          <Txt kind="label" style={{ flexShrink: 1 }}>{copy.priceStatus[price.status]}</Txt>
          {(price.status === 'increase' || price.status === 'decrease') && difference && (
            <View testID="offer-change-price-difference"><ExactAmount money={difference} /></View>
          )}
        </Row>
        {price.status === 'differentCurrency' && <Txt kind="small">{copy.differentCurrency}</Txt>}
        {price.status === 'unavailable' && <Txt kind="small">{copy.unavailable}</Txt>}
        <Row style={{ alignItems: 'stretch', flexWrap: 'wrap', gap: 10 }}>
          <View testID="offer-change-before-price" style={{ flex: 1, minWidth: 115, gap: 5, backgroundColor: colors.surface, padding: 12, borderRadius: 12 }}>
            <Txt kind="small">{copy.previousTotal}</Txt><ExactAmount money={price.before} />
          </View>
          <View testID="offer-change-after-price" style={{ flex: 1, minWidth: 115, gap: 5, backgroundColor: colors.surface, padding: 12, borderRadius: 12 }}>
            <Txt kind="small">{copy.updatedTotal}</Txt><ExactAmount money={price.after} />
          </View>
        </Row>
      </View>
      {!changes.length && <Txt kind="small">{copy.updatedOnly}</Txt>}
      {changes.includes('room') && (
        <View style={{ gap: 6 }}>
          <Txt kind="label">{copy.kind.room}</Txt>
          {before.name === after.name ? (
            <><Txt>{after.name}</Txt><Txt kind="small">{!before.roomIdentity && after.roomIdentity ? copy.roomDetailsSupplied
              : before.roomIdentity && !after.roomIdentity ? copy.roomDetailsMissing : copy.roomDetailsChanged}</Txt></>
          ) : (
            <><Txt>{copy.before}: {before.name}</Txt><Txt>{copy.after}: {after.name}</Txt></>
          )}
        </View>
      )}
      {changes.includes('meal') && (
        <View style={{ gap: 6 }}>
          <Txt kind="label">{copy.kind.meal}</Txt>
          <Txt>{copy.before}: {meal(before)}</Txt><Txt>{copy.after}: {meal(after)}</Txt>
        </View>
      )}
      {changes.filter(kind => kind === 'bedding' || kind === 'payment').map(kind => <View key={kind} testID={`offer-change-${kind}`} style={{ gap: 6 }}>
        <Txt kind="label">{copy.kind[kind]}</Txt>
        {([['before', before], ['after', after]] as const).map(([side, offer]) => <Txt key={side}>
          {copy[side]} · {kind === 'payment' ? roomPaymentLabel(offer, language) : offer.bedding || rateCopy(language).unknown}
        </Txt>)}
      </View>)}
      {nestedChanges.length > 0 && (
        <View style={{ gap: 10 }}>
          {nestedChanges.map(kind => <View key={kind} style={{ gap: 3 }}>
            <Txt kind="label">{copy.kind[kind]}</Txt>
            <Txt kind="small">{kind === 'taxes' ? copy.taxesChanged : copy.cancellationChanged}</Txt>
            {kind === 'taxes' && !detailsOpen && <Taxes taxes={after.taxes} mode="updated" summaryOnly/>}
          </View>)}
          <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} aria-expanded={detailsOpen}
            onPress={() => setDetailsOpen(value => !value)} style={{ minHeight: 48, justifyContent: 'center', paddingVertical: 10 }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Txt kind="label" style={{ color: colors.blueStrong, flex: 1 }}>{copy.details}</Txt>
              <Txt accessible={false} style={{ color: colors.blueStrong }}>{detailsOpen ? '−' : '+'}</Txt>
            </Row>
          </Pressable>
          {detailsOpen && nestedChanges.map(kind => (
            <View key={kind} testID={`offer-change-${kind}-details`} style={{ gap: 10 }}>
              <Txt kind="label">{copy.kind[kind]}</Txt>
              {([['before', before], ['after', after]] as const).map(([side, offer]) => (
                <View key={side} style={{ padding: 14, borderRadius: 14, backgroundColor: colors.surface, gap: 8 }}>
                  <Txt kind="label" style={{ color: colors.blueStrong }}>{copy[side]}</Txt>
                  {kind === 'taxes' ? <Taxes taxes={offer.taxes} mode={side === 'before' ? 'historical' : 'updated'} defaultExpanded/>
                    : <Cancellation offer={offer} mode={side === 'before' ? 'historical' : 'current'} defaultExpanded />}
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
