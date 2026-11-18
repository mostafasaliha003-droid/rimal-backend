import React from 'react';
import { View } from 'react-native';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import type { RoomOffer } from '../types';
import type { cancellationDecision } from './cancellationDecision';
import { mealDescription } from './roomRateFacts';
import { Icon, Row, Txt } from './Primitives';

export function MealBadge({ offer }: { offer: Pick<RoomOffer, 'meal' | 'noChildMeal'> }) {
  const { language, rtl } = useLanguage();
  const named = Boolean(offer.meal && offer.meal.toLowerCase() !== 'nomeal');
  return <View style={{ alignItems: rtl ? 'flex-end' : 'flex-start' }}>
    <Row style={{ maxWidth: '100%', gap: 7, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, backgroundColor: named ? colors.softGold : colors.background }}>
      <Icon name="meal" size={16} color={named ? colors.goldInk : colors.muted}/>
      <Txt kind="label" style={{ color: named ? colors.goldInk : colors.muted, flexShrink: 1 }}>{mealDescription(offer, language)}</Txt>
    </Row>
  </View>;
}

export function CancellationSummary({ decision }: { decision: ReturnType<typeof cancellationDecision> }) {
  const ink = decision.kind === 'free' ? colors.success : decision.kind === 'fee' ? colors.goldInk : colors.muted;
  return <View testID="rate-cancellation-summary" style={{ borderRadius: 13, padding: 10,
    backgroundColor: decision.kind === 'free' ? colors.pistachio : decision.kind === 'fee' ? colors.softGold : colors.background }}>
    <Row style={{ gap: 8, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 3 }}><Icon name={decision.kind === 'free' ? 'check' : decision.kind === 'fee' ? 'clock' : 'info'} size={16} color={ink}/></View>
      <View style={{ flex: 1, gap: 3 }}><Txt kind="label" style={{ color: ink }}>{decision.headline}</Txt>
        {!!decision.detail && <Txt kind="small" style={{ color: colors.ink }}>{decision.detail}</Txt>}
      </View>
    </Row>
  </View>;
}
