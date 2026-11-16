import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COUNTRY_CODES } from '../api';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { Button, Field, Row, Txt } from './Primitives';

export function countryName(code: string, language: string) { try { return new Intl.DisplayNames([language], { type: 'region' }).of(code.toUpperCase()) || code.toUpperCase(); } catch { return code.toUpperCase(); } }
export default function CountryPicker({ visible, value, onClose, onChange }: { visible: boolean; value: string; onClose: () => void; onChange: (code: string) => void }) {
  const { language, t } = useLanguage(); const [query, setQuery] = useState('');
  const countries = useMemo(() => COUNTRY_CODES.map(code => ({ code, name: countryName(code, language) })).filter(country => `${country.code} ${country.name}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).sort((a, b) => a.name.localeCompare(b.name, language)), [query, language]);
  return <Modal visible={visible} animationType="slide" onRequestClose={onClose}><SafeAreaView style={ui.screen}><View style={{ padding: 20, gap: 16 }}><Row style={{ justifyContent: 'space-between' }}><Txt kind="heading">{t('residency')}</Txt><Button compact variant="quiet" title={t('close')} onPress={onClose} /></Row><Field label={t('residency')} value={query} onChangeText={setQuery} placeholder={t('destinationHint')} autoCorrect={false} /></View><FlatList keyboardShouldPersistTaps="handled" data={countries} keyExtractor={item => item.code} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }} renderItem={({ item }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: item.code === value }} onPress={() => { onChange(item.code); onClose(); setQuery(''); }} style={{ padding: 17, minHeight: 56, backgroundColor: item.code === value ? colors.softBlue : '#fff', borderBottomColor: colors.border, borderBottomWidth: 1 }}><Row style={{ justifyContent: 'space-between' }}><Txt style={{ flex: 1 }}>{item.name}</Txt><Txt kind="label">{item.code.toUpperCase()}</Txt></Row></Pressable>} /></SafeAreaView></Modal>;
}
