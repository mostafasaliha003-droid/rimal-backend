import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COUNTRY_CODES } from '../api';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { Button, Field, Row, Txt } from './Primitives';
import { countryNames } from './countryNames';
import { flagEmoji } from './flags';

/** Full country name in the interface language (Arabic or English); never a bare code for a known country. */
export function countryName(code: string, language: string) {
  const names = countryNames[code?.toLowerCase()];
  if (!names) return (code || '').toUpperCase();
  return language === 'ar' ? names[1] : names[0];
}
/** The name in the other language, shown beside the main one. */
export function countryNameSecondary(code: string, language: string) {
  const names = countryNames[code?.toLowerCase()];
  return names ? (language === 'ar' ? names[0] : names[1]) : '';
}

// The region's guests first, so most people find their nationality without typing.
const FREQUENT = ['ae', 'sa', 'kw', 'qa', 'bh', 'om', 'eg', 'jo', 'lb', 'iq', 'ps', 'sy', 'ma', 'in', 'pk', 'gb', 'us'];

export default function CountryPicker({ visible, value, onClose, onChange, title, allowed }: { visible: boolean; value: string; title?: string; allowed?: readonly string[]; onClose: () => void; onChange: (code: string) => void }) {
  const { language, t } = useLanguage(); const [query, setQuery] = useState('');
  const ar = language === 'ar';
  const countries = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (allowed || COUNTRY_CODES)
      .map(code => ({ code, name: countryName(code, language), other: countryNameSecondary(code, language) }))
      // Either language matches, so a guest can type the name they know.
      .filter(country => !needle || `${country.name} ${country.other} ${country.code}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name, language));
  }, [query, language, allowed]);
  // Without a search: the current choice, then frequent nationalities, then every country A–Z.
  const rows = useMemo(() => {
    if (query.trim()) return countries.map(country => ({ ...country, key: country.code, header: '' }));
    const pinned = [value, ...FREQUENT].filter((code, index, list) => code && list.indexOf(code) === index)
      .map(code => countries.find(country => country.code === code)).filter((country): country is typeof countries[number] => Boolean(country));
    return [...pinned.map((country, index) => ({ ...country, key: 'top-' + country.code, header: index === 0 ? (ar ? 'الأكثر اختياراً' : 'Most chosen') : '' })),
      ...countries.map((country, index) => ({ ...country, key: country.code, header: index === 0 ? (ar ? 'كل الدول' : 'All countries') : '' }))];
  }, [countries, query, value, ar]);
  const heading = title || t('residency');
  return <Modal accessibilityLabel={heading} visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={ui.screen}>
      <View style={{ padding: 20, gap: 16 }}>
        <Row style={{ justifyContent: 'space-between' }}><Txt kind="heading">{heading}</Txt><Button compact variant="quiet" title={t('close')} onPress={onClose} /></Row>
        <Field label={ar ? 'ابحث عن بلد' : 'Search for a country'} value={query} onChangeText={setQuery}
          placeholder={ar ? 'مثال: الأردن أو Jordan' : 'e.g. Jordan or الأردن'} autoCorrect={false} />
      </View>
      <FlatList keyboardShouldPersistTaps="handled" data={rows} keyExtractor={item => item.key} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
        renderItem={({ item }) => <View>{!!item.header && <Txt kind="label" accessibilityRole="header" style={{ paddingTop: 12, paddingBottom: 6 }}>{item.header}</Txt>}<Pressable accessibilityRole="button" accessibilityLabel={`${item.name}، ${item.other}`} accessibilityState={{ selected: item.code === value }}
          onPress={() => { onChange(item.code); onClose(); setQuery(''); }}
          style={{ paddingVertical: 8, paddingHorizontal: 16, minHeight: 56, justifyContent: 'center', backgroundColor: item.code === value ? colors.softBlue : '#fff', borderBottomColor: colors.border, borderBottomWidth: 1 }}>
          <Row style={{ gap: 12 }}>
            <Txt accessible={false} style={{ fontSize: 24, lineHeight: 32 }}>{flagEmoji(item.code)}</Txt>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Txt kind="label">{item.name}</Txt>
              {item.other ? <Txt kind="caption">{item.other}</Txt> : null}
            </View>
          </Row>
        </Pressable></View>} />
    </SafeAreaView>
  </Modal>;
}
