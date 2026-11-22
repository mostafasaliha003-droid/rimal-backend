import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import { useRouter } from 'expo-router';
import type { GuestRating } from '../api/reviews';
import type { HotelSummary } from '../types';
import { useLanguage } from '../i18n';
import { color, space } from '../theme';
import { Badge, Card, Icon, Row, Txt } from './Primitives';
import GuestRatingBadge from './GuestRatingBadge';
import { useChargeMoney } from './ChargeCurrency';
import { formatPrice } from './format';
import { rememberHotelPreview } from './hotelPreview';
import { priceInCurrency, type TopPick } from './resultsDecisionModel';

const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);
const LABELS: Record<TopPick['kind'], [string, string]> = {
  value: ['أفضل قيمة', 'Best value'], rated: ['الأعلى تقييماً', 'Top rated'], lowest: ['الأقل سعراً', 'Lowest price'],
};

/** Three honest shortcuts at the top of the results, each one tap from its hotel. */
export default function TopPicks({ picks, currency, ratings, onOpen }: {
  picks: readonly TopPick[]; currency: string; ratings: ReadonlyMap<number, GuestRating | null>; onOpen?: (hid: number) => void;
}) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const router = useRouter();
  const charge = useChargeMoney();
  if (picks.length < 2) return null;
  const open = (hotel: HotelSummary) => {
    onOpen?.(hotel.hid);
    rememberHotelPreview(hotel.hid, { name: hotel.name, photo: hotel.imageUrl, stars: hotel.stars, address: hotel.address });
    router.push({ pathname: '/hotel/[hid]', params: { hid: String(hotel.hid) } });
  };
  return <Card testID="results-top-picks" padded={false} style={styles.card}>
    <Row style={styles.head}><Icon name="sparkles" size={16} color={color.accent}/>
      <Txt kind="label" accessibilityRole="header" style={{ flex: 1 }}>{ar ? 'أبرز الخيارات في هذا البحث' : 'Top picks in this search'}</Txt></Row>
    {picks.map((pick, index) => {
      const price = formatPrice(charge(priceInCurrency(pick.hotel.price, currency)));
      const label = LABELS[pick.kind][ar ? 0 : 1];
      return <Pressable key={pick.kind} testID={'top-pick-' + pick.kind} accessibilityRole="button"
        accessibilityLabel={[label, pick.hotel.name, price].filter(Boolean).join(' · ')} onPress={() => open(pick.hotel)}
        style={state => [styles.row, index > 0 && styles.rule, (state.pressed || hovered(state)) && { backgroundColor: color.bgMuted }]}>
        <Row style={{ gap: space.sm }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Row style={{ gap: space.xs }}><Badge tone="accent" label={label}/><GuestRatingBadge rating={ratings.get(pick.hotel.hid)}/></Row>
            <Txt kind="label" tone="primary" numberOfLines={1}>{pick.hotel.name}</Txt>
          </View>
          {!!price && <Txt kind="label" tone="primary" style={{ writingDirection: 'ltr' }}>{price}</Txt>}
          <Icon name="chevron" size={16} color={color.textSecondary}/>
        </Row>
      </Pressable>;
    })}
  </Card>;
}

const styles = StyleSheet.create({
  card: { gap: 0, overflow: 'hidden' },
  head: { gap: space.xs, paddingHorizontal: space.md, paddingTop: space.sm + 2, paddingBottom: space.xs },
  row: { minHeight: 60, justifyContent: 'center', paddingHorizontal: space.md, paddingVertical: space.sm },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
});
