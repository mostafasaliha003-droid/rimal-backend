import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { RoomOffer } from '../types';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { Icon, Row, Txt } from './Primitives';
import { cancellationCopy } from './cancellationCopy';
import { cancellationDecision, isFullStayCharge, policyTime } from './cancellationDecision';
import { cancellationMoneyText, futureCancellationBoundaries, presentCancellation, type CancellationPresentation } from './cancellationPresentationModel';

function shortTime(time: number, language: string) {
  const date = new Date(time);
  try {
    return new Intl.DateTimeFormat(language === 'ar' ? 'ar-AE' : language, {
      calendar: 'gregory', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      ...(date.getUTCSeconds() || date.getUTCMilliseconds() ? { second: '2-digit' } : {}),
      ...(date.getUTCMilliseconds() ? { fractionalSecondDigits: 3 as const } : {}),
    }).format(date);
  } catch { return date.toISOString(); }
}

export default function CancellationExplorer({ offer, live, now }: { offer: RoomOffer; live: CancellationPresentation; now: number }) {
  const { language } = useLanguage(), ar = language === 'ar';
  const [picked, setPicked] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const boundaries = futureCancellationBoundaries(live, now);
  const selected = picked !== null && boundaries.includes(picked) ? picked : null;
  const model = selected === null ? live : presentCancellation(offer.cancellation, selected);
  const decision = cancellationDecision(model, language, offer.price);
  const cost = cancellationMoneyText(model.fee);
  const tone = model.kind === 'free' ? colors.pistachioMist : model.kind === 'fee' ? colors.softGold : colors.background;
  const ink = model.kind === 'free' ? colors.leafInk : model.kind === 'fee' ? colors.goldInk : colors.muted;
  const description = model.reason === 'gap' ? (ar ? 'لم ترد رسوم إلغاء لهذا الوقت.' : 'No cancellation fee was supplied for this time.')
    : model.reason ? cancellationCopy(language).reasons[model.reason] : decision.detail;
  const title = selected === null ? (ar ? 'رسوم الإلغاء الآن' : 'Fee to cancel now') : (ar ? 'رسوم الإلغاء عند الموعد المختار' : 'Fee at the selected time');
  const costLabel = model.kind === 'free' ? (ar ? 'مجانًا' : 'Free')
    : isFullStayCharge(model.fee, offer.price) ? (ar ? 'كامل سعر الإقامة' : 'Full stay price') : '';
  return <View testID="cancellation-explorer" style={{ gap: 8 }}>
    <Txt kind="heading" accessibilityRole="header" style={styles.title}>{ar ? 'كم سأدفع إذا ألغيت؟' : 'What would cancellation cost?'}</Txt>
    {boundaries.length > 0 && <>
      <Txt kind="small">{ar ? 'اختر موعدًا بتوقيت جهازك' : 'Choose a time in your timezone'}</Txt>
      <Row style={styles.times}>
        {[null, ...(all ? boundaries : boundaries.slice(0, 2))].map((time,index) => {
          const active = selected === time;
          const label = time === null ? (ar ? 'الآن' : 'Now') : shortTime(time, language);
          const full = time === null ? label : policyTime(new Date(time).toISOString(), language, 'device');
          return <Pressable key={time ?? 'now'} testID={time === null ? 'cancellation-moment-now' : 'cancellation-moment-' + index}
            accessibilityRole="button" accessibilityLabel={full || label} accessibilityState={{selected:active}} aria-pressed={active}
            onPress={() => setPicked(time)} style={({pressed})=>[styles.time, active && styles.active, pressed && {opacity:.8}]}>
            <Txt kind="label" style={[styles.timeText, active && {color:colors.surface}]}>{label}</Txt>
          </Pressable>;
        })}
        {!all && boundaries.length > 2 && <Pressable accessibilityRole="button" testID="cancellation-more-times" onPress={()=>setAll(true)} style={styles.time}>
          <Txt kind="label" style={styles.timeText}>{ar ? 'بقية المواعيد' : 'More times'}</Txt>
        </Pressable>}
      </Row>
    </>}
    <View testID="cancellation-estimate" accessibilityLiveRegion="polite" style={[styles.answer,{backgroundColor:tone}]}>
      <Row style={{gap:7}}><Icon name={model.kind==='unknown'?'info':'clock'} size={17} color={ink}/><Txt kind="label" style={{flex:1,color:ink}}>{title}</Txt></Row>
      <Row style={{ gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <Txt testID="cancellation-estimate-amount" kind="heading" style={[styles.amount, cost && {writingDirection:'ltr'}]}>
          {cost || (ar ? 'غير محددة' : 'Unconfirmed')}
        </Txt>
        {!!costLabel && <Txt kind="label" style={{color:ink}}>{costLabel}</Txt>}
      </Row>
      {selected !== null && <Txt kind="small" style={{color:colors.ink}}>{policyTime(new Date(selected).toISOString(),language,'device')}</Txt>}
      {!!description && <Txt kind="small" style={{color:colors.ink}}>{description}</Txt>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  title:{fontSize:20,lineHeight:29}, times:{gap:6,flexWrap:'wrap'},
  time:{minHeight:44,maxWidth:'100%',paddingHorizontal:11,paddingVertical:5,borderRadius:13,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,justifyContent:'center'},
  active:{borderColor:colors.violetInk,backgroundColor:colors.violetInk},
  timeText:{fontSize:13,lineHeight:21,color:colors.violetInk,textAlign:'center'},
  answer:{padding:14,gap:5,borderRadius:16}, amount:{fontSize:25,lineHeight:34},
});
