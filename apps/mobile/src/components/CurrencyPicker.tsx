import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { Button, Field, Icon, Row, Txt } from './Primitives';
import { bookingCurrency, currencyName, findCurrencies } from './currencyCatalog';
import { APP_ENV } from '../api/config';

interface CurrencyPickerProps {
  visible: boolean;
  value: string;
  automatic: boolean;
  onClose: () => void;
  onChange: (code: string) => void;
  onAutomatic: () => void;
}

export default function CurrencyPicker(props: CurrencyPickerProps) {
  if (!props.visible) return null;
  return <CurrencyDialog {...props}/>;
}

function CurrencyDialog({ value, automatic, onChange, onAutomatic, onClose }: CurrencyPickerProps) {
  const { language, t } = useLanguage();
  const ar = language === 'ar';
  const [query, setQuery] = useState('');
  const codes = useMemo(() => {
    const matches = findCurrencies(query, language);
    if (query.trim()) return matches;
    const first = new Set([value, 'AED', 'USD', 'SAR', 'EUR', 'GBP']);
    return [...first].filter(code => matches.includes(code)).concat(matches.filter(code => !first.has(code)));
  }, [language, query, value]);
  const title = ar ? 'اختر العملة' : 'Choose currency';
  const autoTitle = ar ? 'تلقائي حسب البلد' : 'Automatic by country';
  const manualHint = ar ? 'تقدير للعرض · الحجز بالدولار الأمريكي' : 'Estimated prices · book in USD';
  return <Modal visible accessibilityLabel={title} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={ui.screen}>
      <View style={styles.header}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Txt kind="heading" accessibilityRole="header" style={{ flex: 1 }}>{title}</Txt>
          <Button compact variant="quiet" title={t('close')} onPress={onClose}/>
        </Row>
        <Field testID="currency-filter" label={ar ? 'ابحث باسم العملة أو رمزها' : 'Search by currency name or code'}
          placeholder={ar ? 'درهم، دولار، EUR…' : 'Dirham, dollar, EUR…'} autoCorrect={false}
          maxLength={80} value={query} onChangeText={setQuery}/>
      </View>
      <FlatList testID="currency-list" keyboardShouldPersistTaps="handled" data={codes} keyExtractor={code => code}
        contentContainerStyle={styles.list}
        ListHeaderComponent={query.trim() ? undefined : <Pressable testID="currency-automatic" accessibilityRole="button"
          accessibilityState={{ selected: automatic }} onPress={() => { onAutomatic(); onClose(); }}
          style={({ pressed }) => [styles.row, styles.auto, pressed && styles.pressed]}>
          <Row style={styles.inner}>
            <Icon name="pin" size={20} color={colors.violetInk}/>
            <View style={styles.name}><Txt kind="label">{autoTitle}</Txt></View>
            {automatic && <Icon name="check" size={18} color={colors.violetInk}/>}
          </Row>
        </Pressable>}
        ListEmptyComponent={<Txt accessibilityLiveRegion="polite" style={styles.empty}>{ar ? 'لم نجد عملة بهذا الاسم أو الرمز.' : 'No currency matches this name or code.'}</Txt>}
        renderItem={({ item: code }) => {
          const name = currencyName(code, language);
          const estimate = bookingCurrency(code, APP_ENV) !== code;
          const selected = !automatic && code === value;
          return <Pressable testID={'currency-option-' + code} accessibilityRole="button"
            accessibilityLabel={[name, code, estimate && manualHint].filter(Boolean).join(' · ')}
            accessibilityState={{ selected }} onPress={() => { onChange(code); onClose(); }}
            style={({ pressed }) => [styles.row, selected && styles.selected, pressed && styles.pressed]}>
            <Row style={styles.inner}>
              <View style={styles.name}><Txt kind="label">{name}</Txt>{estimate && <Txt kind="small">{manualHint}</Txt>}</View>
              <Txt kind="label" style={styles.code}>{code}</Txt>
              {selected && <Icon name="check" size={17} color={colors.violetInk}/>}
            </Row>
          </Pressable>;
        }}/>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, gap: 8 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { minHeight: 54, backgroundColor: colors.surface, justifyContent: 'center', paddingHorizontal: 13,
    paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  auto: { borderRadius: 14, borderBottomWidth: 0, marginBottom: 8, backgroundColor: colors.softBlue },
  selected: { backgroundColor: colors.softBlue },
  pressed: { opacity: 0.78 },
  name: { flex: 1, gap: 2 },
  inner: { alignItems: 'center', gap: 10 },
  code: { color: colors.violetInk, writingDirection: 'ltr' },
  empty: { paddingVertical: 16 },
});
