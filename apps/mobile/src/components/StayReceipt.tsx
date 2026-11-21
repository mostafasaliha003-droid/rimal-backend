import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLanguage } from '../i18n';
import { color, fonts, radius, space } from '../theme';
import { Divider, InfoRow, Row, Txt } from './Primitives';

export interface StayReceiptData {
  hotelName?: string | null;
  /** Already formatted: "21–24 Dec · 3 nights". */
  stay?: string | null;
  guests?: string | null;
  /** Already localized room name, optionally with its meal plan. */
  room?: string | null;
  /** Already formatted amount that was charged for this booking. */
  paid?: string | null;
}

/**
 * What was booked, restated the moment it is confirmed: hotel, dates, guests, room and the
 * amount paid. Only facts this device or the account's booking record already holds are shown;
 * a missing fact is left out rather than guessed.
 */
export default function StayReceipt({ data, testID = 'stay-receipt' }: { data: StayReceiptData; testID?: string }) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  if (!data.hotelName && !data.stay) return null;
  return <View testID={testID} style={styles.box} accessibilityLabel={ar ? 'تفاصيل الحجز المؤكد' : 'Confirmed booking details'}>
    {!!data.hotelName && <Txt kind="bodyStrong" numberOfLines={2} style={{ fontFamily: fonts.bold }}>{data.hotelName}</Txt>}
    {!!data.stay && <InfoRow icon="calendar"><Txt kind="small" tone="primary">{data.stay}</Txt></InfoRow>}
    {!!data.guests && <InfoRow icon="users"><Txt kind="small" tone="primary">{data.guests}</Txt></InfoRow>}
    {!!data.room && <InfoRow icon="bed"><Txt kind="small" tone="primary">{data.room}</Txt></InfoRow>}
    {!!data.paid && <>
      <Divider style={{ marginVertical: space.xxs }}/>
      <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: space.md }}>
        <Txt kind="small" tone="primary">{ar ? 'المبلغ المدفوع' : 'Amount paid'}</Txt>
        <Txt testID={testID + '-paid'} kind="subheading" style={{ writingDirection: 'ltr' }}>{data.paid}</Txt>
      </Row>
    </>}
  </View>;
}

const styles = StyleSheet.create({
  box: { alignSelf: 'stretch', gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: color.bgSubtle },
});
