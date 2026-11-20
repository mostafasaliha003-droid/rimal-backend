import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COUNTRY_CODES } from '../api';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { Button, Field, Row, Txt } from './Primitives';
import { countryNames } from './countryNames';

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
  const heading = title || t('residency');
  return <Modal accessibilityLabel={heading} visible={visible} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={ui.screen}>
      <View style={{ padding: 20, gap: 16 }}>
        <Row style={{ justifyContent: 'space-between' }}><Txt kind="heading">{heading}</Txt><Button compact variant="quiet" title={t('close')} onPress={onClose} /></Row>
        <Field label={ar ? 'ابحث عن بلد' : 'Search for a country'} value={query} onChangeText={setQuery}
          placeholder={ar ? 'مثال: الأردن أو Jordan' : 'e.g. Jordan or الأردن'} autoCorrect={false} />
      </View>
      <FlatList keyboardShouldPersistTaps="handled" data={countries} keyExtractor={item => item.code} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
        renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}، ${item.other}`} accessibilityState={{ selected: item.code === value }}
          onPress={() => { onChange(item.code); onClose(); setQuery(''); }}
          style={{ paddingVertical: 12, paddingHorizontal: 17, minHeight: 60, justifyContent: 'center', backgroundColor: item.code === value ? colors.softBlue : '#fff', borderBottomColor: colors.border, borderBottomWidth: 1 }}>
          <Txt kind="label">{item.name}</Txt>
          {item.other ? <Txt kind="caption">{item.other}</Txt> : null}
        </Pressable>} />
    </SafeAreaView>
  </Modal>;
}
