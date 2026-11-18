import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors, fonts } from '../theme';
import type { MealFacet, MealPlanOption } from './roomChoiceModel';
import { mealPlanTitle } from './roomRateFacts';
import { Icon, Row, Txt } from './Primitives';

export default function MealPlanPicker({ value, options, onChange }: {
  value: MealFacet; options: MealPlanOption[]; onChange: (value: MealFacet) => void;
}) {
  const { language, rtl } = useLanguage();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const all = rtl ? 'عرض جميع الخطط' : 'Show all plans';
  const selected = value.kind === 'all' ? (rtl ? 'اختيار الوجبات' : 'Meal plans') : mealPlanTitle(value.kind === 'value' ? value.value : undefined, language);
  const title = rtl ? 'اختر وجبات الإقامة' : 'Choose your meal plan';
  const choose = (next: MealFacet) => { onChange(next); setOpen(false); };
  const row = (label: string, next: MealFacet, checked: boolean, option?: MealPlanOption) => (
    <Pressable key={JSON.stringify(next)} accessibilityRole="radio" accessibilityState={{ checked }}
      testID={next.kind === 'all' ? 'meal-all' : next.kind === 'missing' ? 'meal-unspecified' : 'meal-value-' + next.value}
      onPress={() => choose(next)} style={{ paddingVertical: 10, paddingHorizontal: 12, minHeight: 52, borderWidth: 1,
        backgroundColor: checked ? colors.softGold : colors.surface, borderColor: checked ? colors.goldInk : colors.border, borderRadius: 14 }}>
      <Row style={{ gap: 10 }}><Icon name="meal" size={19} color={checked ? colors.goldInk : colors.muted}/>
        <View style={{ flex: 1, gap: 1 }}><Txt kind="label">{label}</Txt>
          {option && <Txt kind="small">{rtl ? `عدد العروض ${option.count}` : `${option.count} ${option.count === 1 ? 'offer' : 'offers'}`}
            {option.fromPrice && ` · ${rtl ? 'الإقامة من' : 'Stay from'} ${option.fromPrice.currency} ${option.fromPrice.amount}`}
          </Txt>}
        </View>
        <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: checked ? colors.navy : colors.muted,
          alignItems: 'center', justifyContent: 'center', backgroundColor: checked ? colors.navy : colors.surface }}>
          {checked && <Icon name="check" size={14} color={colors.surface}/>}
        </View>
      </Row>
    </Pressable>);
  return <>
    <Pressable testID="meal-plan-picker" accessibilityRole="button" accessibilityLabel={`${title} · ${selected}`}
      accessibilityState={{ expanded: open }} onPress={() => setOpen(true)}
      style={{ minHeight: 46, flexGrow: 1, flexBasis: 126, borderWidth: 1, borderColor: colors.border, borderRadius: 14,
        paddingHorizontal: 10, justifyContent: 'center', backgroundColor: colors.softGold }}>
      <Row style={{ gap: 6 }}><Icon name="meal" size={17} color={colors.goldInk}/><Txt kind="label" style={{ flex: 1 }}>{selected}</Txt><Icon name="chevron" size={14}/></Row>
    </Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView edges={['top','bottom']} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(32,22,38,.40)', direction: 'ltr' }}>
        <View testID="meal-plan-options" accessibilityViewIsModal style={{ maxHeight: height * .85, width: '100%', maxWidth: 640, alignSelf: 'center',
          backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, gap: 10 }}>
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
