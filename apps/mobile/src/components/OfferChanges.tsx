import React from 'react';
import { View } from 'react-native';
import type { RoomOffer } from '../types';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { MoneyText, Row, Txt } from './Primitives';
import { changedOfferSections } from './offerChangeSummary';
import Taxes from './Taxes';
import Cancellation from './Cancellation';

export default function OfferChanges({ before, after }: { before: RoomOffer; after: RoomOffer }) {
  const { t, language } = useLanguage(), changes = changedOfferSections(before, after);
  const L = language === 'ar'
    ? { title: 'ما الذي تغيّر؟', before: 'عند اختيار الغرفة', after: 'بعد إعادة التحقق',
      none: 'أعاد المورد عرضاً محدثاً. راجع السعر والشروط الحالية قبل الموافقة.', price: 'السعر', room: 'الغرفة', meal: 'الوجبات', taxes: 'الرسوم', cancellation: 'الإلغاء' }
    : { title: 'What changed?', before: 'When you chose the room', after: 'After the price check',
      none: 'The supplier returned an updated offer. Review its current price and terms before accepting.', price: 'Price', room: 'Room', meal: 'Meals', taxes: 'Charges', cancellation: 'Cancellation' };
  return <View style={{ gap: 14 }}>
    <Txt kind="heading" accessibilityRole="header">{L.title}</Txt>
    {!changes.length ? <Txt>{L.none}</Txt> : <>
      <Row style={{ flexWrap: 'wrap', gap: 8 }}>{changes.map(kind => <View key={kind} style={{ backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12 }}><Txt kind="label">{L[kind]}</Txt></View>)}</Row>
      {changes.map(kind => <View key={kind} style={{ gap: 12 }}><Txt kind="label">{L[kind]}</Txt>
        {([['before', before], ['after', after]] as const).map(([side, offer]) => <View key={side} style={[ui.card, { padding: 14, gap: 8 }]}>
          <Txt kind="small" style={{ color: colors.blueStrong }}>{L[side]}</Txt>
          {kind === 'price' ? <MoneyText money={offer.price}/> : kind === 'room' ? <Txt>{offer.name}</Txt>
            : kind === 'meal' ? <Txt>{offer.meal ? offer.meal === 'nomeal' ? t('roomOnly') : offer.meal.replace(/[-_]/g, ' ') : t('noMeal')}</Txt>
              : kind === 'taxes' ? offer.taxes.length ? <Taxes taxes={offer.taxes}/> : <Txt kind="small">{language === 'ar' ? 'لم تُقدّم رسوم لهذا العرض.' : 'No charges supplied for this offer.'}</Txt>
                : <Cancellation offer={offer} mode={side === 'before' ? 'historical' : 'current'} defaultExpanded/>}
        </View>)}
      </View>)}
    </>}
  </View>;
}
