import React, { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import { Button, Row, Txt } from './Primitives';
import { monthDays, shiftMonth, validDate } from './calendarModel';

export default function CalendarPicker({ visible, value, min, max, title, onSelect, onClose }: { visible: boolean; value: string; min: string; max: string; title: string; onSelect: (value: string) => void; onClose: () => void }) {
  const { language, rtl, t } = useLanguage(); const [month, setMonth] = useState(() => (validDate(value) ? value : min).slice(0, 7));
  const heading = new Intl.DateTimeFormat(language, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`));
  const weekdays = Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(language, { weekday: language === 'ar' ? 'narrow' : 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2027, 0, 3 + index))));
  return <Modal accessibilityLabel={title} visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: '#102A4380' }}><SafeAreaView edges={['bottom']} style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 20, maxWidth: 520, width: '100%', alignSelf: 'center', direction: 'ltr' }} accessibilityViewIsModal>
    <Row style={{ justifyContent: 'space-between' }}><Txt kind="heading" accessibilityRole="header">{title}</Txt><Button compact variant="quiet" title={t('close')} onPress={onClose} /></Row>
    <Row style={{ justifyContent: 'space-between' }}><Button compact variant="secondary" title={rtl ? '→' : '←'} label={t('previousMonth')} disabled={month <= min.slice(0, 7)} onPress={() => setMonth(shiftMonth(month, -1))} /><Txt kind="label" style={{ flex: 1, textAlign: 'center' }}>{heading}</Txt><Button compact variant="secondary" title={rtl ? '←' : '→'} label={t('nextMonth')} disabled={month >= max.slice(0, 7)} onPress={() => setMonth(shiftMonth(month, 1))} /></Row>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{weekdays.map((day, index) => <View key={index} style={{ width: `${100/7}%`, alignItems: 'center', paddingBottom: 8 }}><Txt kind="small" style={{ fontFamily: fonts.bold }}>{day}</Txt></View>)}{monthDays(month).map((date, index) => { const disabled = !date || date < min || date > max; const selected = date === value; return <View key={date || `blank-${index}`} style={{ width: `${100/7}%`, padding: 2 }}>{date ? <Pressable disabled={disabled} accessibilityRole="button" accessibilityState={{ disabled, selected }} accessibilityLabel={new Intl.DateTimeFormat(language, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))} onPress={() => { onSelect(date); onClose(); }} style={{ minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: selected ? colors.navy : colors.background }}><Txt style={{ color: disabled ? '#8A99A7' : selected ? '#fff' : colors.navy, fontFamily: fonts.bold, writingDirection: 'ltr' }}>{Number(date.slice(-2))}</Txt></Pressable> : <View style={{ minHeight: 48 }} />}</View>; })}</View>
  </SafeAreaView></View></Modal>;
}
