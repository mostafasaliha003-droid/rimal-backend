import StayEstimate from './StayEstimate';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import type { RoomOffer } from '../types';
import Cancellation from './Cancellation';
import HotelGallery from './HotelGallery';
import { Button, Icon, Row, Txt } from './Primitives';
import { mealPlanTitle, rateCopy, roomRateFacts } from './roomRateFacts';
import Taxes from './Taxes';

interface OfferTermsProps { offer: RoomOffer; visible: boolean; onClose: () => void; now: number; roomName: string }

export default function OfferTermsSheet(props: OfferTermsProps) {
  if (!props.visible) return null;
  return <TermsContent key={props.offer.id} {...props}/>;
}

function TermsContent({ offer, now, roomName, onClose }: OfferTermsProps) {
  const { language, rtl } = useLanguage();
  const { height, width, fontScale } = useWindowDimensions();
  const [section, setSection] = useState<'cancellation' | 'fees'>('cancellation');
  const [photosOpen, setPhotosOpen] = useState(false);
  const facts = roomRateFacts(offer, language, now);
  const copy = rateCopy(language);
  const closeLabel = rtl ? 'إغلاق شروط العرض' : 'Close rate terms';
  const stacked = width / Math.max(1, fontScale) < 320;
  return <Modal transparent visible animationType="slide" onRequestClose={onClose}>
    <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.scrim}>
      <View accessibilityViewIsModal testID="offer-terms-sheet" style={[styles.sheet, { maxHeight: Math.max(160, height * .92) }]}>
        <Row style={styles.header}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt kind="small">{rtl ? 'شروط العرض' : 'Rate terms'}</Txt>
            <Txt kind="heading" accessibilityRole="header">{mealPlanTitle(offer.meal, language)}</Txt>
            <Txt kind="small" numberOfLines={2}>{offer.name || roomName}</Txt>
          </View>
          <Pressable testID="offer-terms-close" accessibilityRole="button" accessibilityLabel={closeLabel}
            style={styles.close} onPress={onClose}><Icon name="close" size={20}/></Pressable>
        </Row>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <View style={styles.pricing}>
            <Row style={{ alignItems: 'stretch', gap: 12, ...(stacked && { flexDirection: 'column' }) }}>
              <View style={[styles.priceColumn, stacked && styles.stackedPrice]}>
                <Txt kind="small" style={styles.priceLabel}>{copy.price}</Txt>
                <Txt testID="offer-terms-stay-total" kind="heading" style={[styles.amount, offer.price && { writingDirection: 'ltr' }]}>{facts.price}</Txt><StayEstimate money={offer.price}/>
              </View>
              <View style={[styles.divider, stacked ? { height: 1 } : { width: 1 }]}/>
              <View style={[styles.priceColumn, stacked && styles.stackedPrice]}>
                <Txt kind="small" style={styles.priceLabel}>{rtl ? 'رسوم تُدفع في الفندق' : 'Fees at the property'}</Txt>
                <Txt testID="offer-terms-property-fees" kind="label" style={styles.propertyAmount}>{facts.fees}</Txt>
              </View>
            </Row>
            <View style={styles.priceRule}/>
            <Row style={styles.meal}><Icon name="meal" size={15} color={colors.pistachio}/><Txt kind="label" style={styles.included}>{facts.meal}</Txt></Row>
            {offer.bedding && <Row style={styles.meal}><Icon name="bed" size={15} color={colors.pistachio}/><Txt kind="small" style={styles.included}>{offer.bedding}</Txt></Row>}
          </View>
          <Row style={styles.sections}>
            {(['cancellation','fees'] as const).map(key => <Pressable key={key} testID={'offer-terms-' + key}
              accessibilityRole="button" accessibilityState={{ selected: section === key }} aria-pressed={section === key} onPress={() => setSection(key)}
              style={[styles.section, section === key && styles.selected]}>
              <Txt kind="label" style={[styles.tabLabel, section === key && { color: colors.surface }]}>
                {key === 'cancellation' ? copy.cancellation : rtl ? 'الدفع والرسوم' : 'Payment & fees'}</Txt>
            </Pressable>)}
          </Row>
          {section === 'cancellation' ? <Cancellation offer={offer} now={now} explore/>
            : <View style={{ gap: 12 }}>
              <Row style={styles.payment}><Icon name="info" size={17} color={colors.violetInk}/>
                <Txt kind="small">{copy.payment}</Txt><Txt kind="label" style={styles.factText}>{facts.payment}</Txt></Row>
              <Taxes taxes={offer.taxes} defaultExpanded/>
            </View>}
          {offer.images.length > 0 && <View style={{ gap: 8 }}>
            <Pressable testID="offer-terms-photos" accessibilityRole="button" accessibilityState={{ expanded: photosOpen }}
              aria-expanded={photosOpen} onPress={() => setPhotosOpen(value => !value)} style={styles.photoButton}>
              <Row><Icon name="bed" size={17}/><Txt kind="label" style={styles.factText}>{rtl ? 'صور هذه الغرفة' : 'Photos of this room'}</Txt>
                <Txt accessible={false} kind="label">{photosOpen ? '−' : '+'}</Txt></Row>
            </Pressable>
            {photosOpen && <HotelGallery images={offer.images} name={offer.name} room/>}
          </View>}
        </ScrollView>
        <View testID="offer-terms-done" style={styles.footer}><Button title={rtl ? 'العودة إلى خيارات الغرف' : 'Back to room options'} onPress={onClose}/></View>
      </View>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: 'rgba(32,22,38,.48)', alignItems: 'center', justifyContent: 'flex-end' },
  sheet: { width: '100%', maxWidth: 680, flexShrink: 1, backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: 'hidden', direction: 'ltr' },
  header: { gap: 12, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1, borderColor: colors.border },
  close: { minWidth: 48, minHeight: 48, borderRadius: 24, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 14 }, pricing: { padding: 15, borderRadius: 18, backgroundColor: colors.primary },
  priceColumn: { flexGrow: 1, flexBasis: 0, minWidth: 0, gap: 2 },
  stackedPrice: { flexGrow: 0, flexBasis: 'auto' },
  priceLabel: { color: colors.pistachio, fontSize: 13, lineHeight: 20 },
  amount: { color: colors.surface, fontSize: 22, lineHeight: 30 },
  propertyAmount: { color: colors.surface, fontSize: 16, lineHeight: 24 },
  divider: { backgroundColor: colors.grape },
  priceRule: { height: 1, marginTop: 10, marginBottom: 3, backgroundColor: colors.grape },
  meal: { gap: 7, paddingTop: 3 }, included: { color: colors.surface, flex: 1 },
  factText: { flex: 1, minWidth: 0 },
  payment: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.lavenderMist },
  sections: { padding: 3, gap: 4, borderRadius: 15, backgroundColor: colors.background },
  section: { flex: 1, minWidth: 0, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', padding: 4 },
  selected: { backgroundColor: colors.primary }, tabLabel: { textAlign: 'center' },
  photoButton: { minHeight: 48, justifyContent: 'center', borderTopWidth: 1, borderColor: colors.border },
  footer: { paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: 1, borderColor: colors.border },
});
