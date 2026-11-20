import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import type { MealFacet, MealPlanOption } from './roomChoiceModel';
import { mealPlanTitle, rateCopy } from './roomRateFacts';
import { Chip, Icon, Row, Txt } from './Primitives';

export default function MealPlanPicker({ value, options, onChange }: {
  value: MealFacet; options: MealPlanOption[]; onChange: (value: MealFacet) => void;
}) {
  const { language, rtl } = useLanguage();
  const { height, width, fontScale } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const all = rtl ? 'عرض جميع الخطط' : 'Show all plans';
  const selected = value.kind === 'all' ? (rtl ? 'اختيار الوجبات' : 'Meal plans') : mealPlanTitle(value.kind === 'value' ? value.value : undefined, language);
  const title = rtl ? 'اختر وجبات الإقامة' : 'Choose your meal plan';
  const choose = (next: MealFacet) => { onChange(next); setOpen(false); };
  const row = (label: string, next: MealFacet, checked: boolean, option?: MealPlanOption) => (
    <Pressable key={JSON.stringify(next)} accessibilityRole="radio" accessibilityState={{ checked }}
      testID={next.kind === 'all' ? 'meal-all' : next.kind === 'missing' ? 'meal-unspecified' : 'meal-value-' + next.value}
      onPress={() => choose(next)} style={[styles.option, { backgroundColor: checked ? colors.softGold : colors.surface, borderColor: checked ? colors.goldInk : colors.border }]}>
      <Row style={{ gap: 10 }}>
        <View style={[styles.optionIcon, checked && { backgroundColor: colors.surface }]}>
          <Icon name={next.kind === 'all' ? 'filter' : next.kind === 'missing' ? 'info' : next.value === 'nomeal' ? 'bed' : 'meal'} size={20} color={colors.goldInk}/>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}><Txt kind="label">{label}</Txt>
          {option && <Txt kind="small">{rateCopy(language).plans(option.count)}</Txt>}
        </View>
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: checked ? colors.navy : colors.muted,
          alignItems: 'center', justifyContent: 'center', backgroundColor: checked ? colors.navy : colors.surface }}>
          {checked && <Icon name="check" size={14} color={colors.surface}/>}
        </View>
      </Row>
      {!!option?.fromPrice && <Row style={{ gap: 7, alignItems: 'baseline', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <Txt kind="small">{rtl ? 'الإقامة من' : 'Stay from'}</Txt>
        <Txt kind="label" style={{ writingDirection: 'ltr' }}>{option.fromPrice.currency} {option.fromPrice.amount}</Txt>
      </Row>}
    </Pressable>);
  return <>
    <Chip size="sm" testID="meal-plan-picker" icon="meal" label={selected} accessibilityLabel={title + ' · ' + selected}
      selected={value.kind !== 'all'} onPress={() => setOpen(true)}/>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView edges={['top','bottom']} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(32,22,38,.40)', direction: 'ltr' }}>
        <View testID="meal-plan-options" accessibilityViewIsModal style={{ maxHeight: height * (fontScale > 1.3 || width < 350 ? .94 : .88), width: '100%', maxWidth: 640, alignSelf: 'center',
          backgroundColor: colors.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 16, gap: 10 }}>
          <Row><Txt kind="heading" accessibilityRole="header" style={{ flex: 1 }}>{title}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={rtl ? 'إغلاق' : 'Close'} onPress={() => setOpen(false)}
              style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={19}/></Pressable>
          </Row>
          <Txt kind="small" style={{ fontFamily: fonts.medium }}>{rtl ? 'الأسعار لكامل الإقامة. اختر خطة لعرض الغرف المطابقة.' : 'Prices cover the full stay. Choose a plan to see matching rooms.'}</Txt>
          <ScrollView accessibilityRole="radiogroup" contentContainerStyle={{ gap: 8, paddingBottom: 14 }}>
            {row(all, { kind: 'all' }, value.kind === 'all')}
            {options.map(plan => row(mealPlanTitle(plan.value ?? undefined, language),
              plan.value === null ? { kind: 'missing' } : { kind: 'value', value: plan.value },
              plan.value === null ? value.kind === 'missing' : value.kind === 'value' && value.value === plan.value, plan))}
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  </>;
}

const styles = StyleSheet.create({
  option: { gap: 8, paddingVertical: 12, paddingHorizontal: 13, minHeight: 58, borderWidth: 1, borderRadius: 16 },
  optionIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.softGold },
});
