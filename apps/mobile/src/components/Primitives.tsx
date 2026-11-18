import React, { useState } from 'react';
import { ActivityIndicator, ColorValue, Image, Platform, Pressable, StyleSheet, Text, TextInput, TextInputProps, TextProps, View, ViewStyle } from 'react-native';
import { colors, fonts, localizedFont, tokens, ui } from '../theme';
import { useLanguage } from '../i18n';
import type { Money } from '../types';

export function Txt({ children, style, kind = 'text', ...props }: TextProps & { kind?: 'text'|'small'|'label'|'heading'|'title' }) {
  const { rtl, language } = useLanguage();
  const family = StyleSheet.flatten([ui[kind], style])?.fontFamily || fonts.regular;
  return <Text {...props} style={[ui[kind], { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }, style, { fontFamily: localizedFont(language, family) }]}>{children}</Text>;
}
export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) { const { rtl } = useLanguage(); return <View style={[ui.row, { flexDirection: rtl ? 'row-reverse' : 'row' }, style]}>{children}</View>; }
export function Button({ title, onPress, variant = 'primary', disabled = false, busy = false, hint, label, compact = false }: { title: string; onPress: () => void; variant?: 'primary'|'secondary'|'quiet'|'danger'; disabled?: boolean; busy?: boolean; hint?: string; label?: string; compact?: boolean }) {
  const { language } = useLanguage();
  const foreground = variant === 'primary' || variant === 'danger' ? '#fff' : colors.navy;
  return <Pressable accessibilityRole="button" accessibilityLabel={label || title} accessibilityHint={hint} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, compact && { paddingHorizontal: 12, minHeight: tokens.control.minHeight, minWidth: tokens.control.minHeight }, variant === 'primary' ? { backgroundColor: colors.navy } : variant === 'danger' ? { backgroundColor: colors.red } : { backgroundColor: variant === 'quiet' ? 'transparent' : '#fff', borderColor: colors.border, borderWidth: variant === 'quiet' ? 0 : 1 }, { opacity: disabled || busy ? .5 : pressed ? .75 : 1 }]}>
    {busy && <ActivityIndicator color={foreground} />}<Text style={[styles.buttonText, { color: foreground, fontFamily: localizedFont(language, fonts.bold) }]}>{title}</Text>
  </Pressable>;
}
export function Field({ label, error, errorId, inputRef, style, ltr = false, ...props }: TextInputProps & {
  label: string; error?: string; errorId?: string; inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>; ltr?: boolean;
}) {
  const { rtl, language } = useLanguage(); const [focused, focus] = useState(false);
  const errorLink = Platform.OS === 'web' && error && errorId ? { 'aria-invalid': true, 'aria-describedby': errorId } : undefined;
  return <View style={{ gap: 6, flexShrink: 1 }}><Txt kind="label">{label}</Txt><TextInput {...props} {...errorLink} ref={inputRef} accessibilityLabel={label} accessibilityHint={error || props.accessibilityHint} placeholderTextColor={colors.muted} onFocus={event => { focus(true); props.onFocus?.(event); }} onBlur={event => { focus(false); props.onBlur?.(event); }} style={[ui.input, { fontFamily: localizedFont(language, fonts.medium), textAlign: ltr ? 'left' : rtl ? 'right' : 'left', writingDirection: ltr ? 'ltr' : rtl ? 'rtl' : 'ltr', borderColor: error ? colors.red : focused ? colors.blueStrong : colors.border }, style]} />{error && <Txt nativeID={errorId} accessibilityRole="alert" style={{ color: colors.red }} kind="small">{error}</Txt>}</View>;
}
export function Photo({ uri, label, room = false, height = 210 }: { uri?: string; label: string; room?: boolean; height?: number }) {
  const { t } = useLanguage(); const [failedSource, fail] = useState<string | null>(null);
  return uri && failedSource !== uri ? <Image accessibilityLabel={label} source={{ uri }} onError={() => fail(uri)} resizeMode="cover" style={{ width: '100%', height, backgroundColor: colors.softBlue }} /> : <View style={{ height, backgroundColor: colors.softBlue, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 }}><Text accessible={false} style={{ fontSize: 25, color: colors.blueStrong }}>▧</Text><Txt kind="small" style={{ textAlign: 'center' }}>{t(room ? 'roomPhotoUnknown' : 'photoUnknown')}</Txt></View>;
}
export function MoneyText({ money, large = false }: { money: Money | null | undefined; large?: boolean }) {
  const { language, t } = useLanguage(); const value = Number(money?.amount);
  if (!money || !Number.isFinite(value) || value < 0 || !/^[A-Z]{3}$/.test(money.currency)) return <Txt kind="small">{t('priceUnknown')}</Txt>;
  let text: string;
  try { text = new Intl.NumberFormat(language === 'ar' ? 'ar-AE' : 'en-US', { style: 'currency', currency: money.currency, currencyDisplay: 'code', maximumFractionDigits: 3 }).format(value); } catch { text = `${money.amount} ${money.currency}`; }
  return <Txt style={{ color: colors.navy, fontFamily: fonts.bold, fontSize: large ? 26 : 21, lineHeight: large ? 36 : 30 }}>{text}</Txt>;
}
export function StatePanel({ title, body, retry, busy = false }: { title: string; body?: string; retry?: () => void; busy?: boolean }) { const { t } = useLanguage(); return <View style={[ui.card, { alignItems: 'stretch', paddingVertical: 30 }]}>{busy && <ActivityIndicator size="large" color={colors.blueStrong} />}<Txt kind="heading" accessibilityRole={busy ? 'text' : 'header'}>{title}</Txt>{body && <Txt style={{ color: colors.muted }}>{body}</Txt>}{retry && <Button variant="secondary" title={t('retry')} onPress={retry} />}</View>; }
const icons = {
  search: require('../../assets/icons/search.png'), saved: require('../../assets/icons/saved.png'),
  trips: require('../../assets/icons/trips.png'), account: require('../../assets/icons/account.png'),
  support: require('../../assets/icons/support.png'), calendar: require('../../assets/icons/calendar.png'),
  filter: require('../../assets/icons/filter.png'), map: require('../../assets/icons/map.png'), pin: require('../../assets/icons/pin.png'),
  chevron: require('../../assets/icons/chevron.png'), back: require('../../assets/icons/back.png'), bed: require('../../assets/icons/bed.png'),
  users: require('../../assets/icons/users.png'), check: require('../../assets/icons/check.png'), info: require('../../assets/icons/info.png'),
  meal: require('../../assets/icons/meal.png'), compare: require('../../assets/icons/compare.png'), close: require('../../assets/icons/close.png'),
  clock: require('../../assets/icons/clock.png'),
};
export function Icon({ name, color, size = 24 }: { name: keyof typeof icons; color?: ColorValue | null; size?: number }) {
  const { rtl } = useLanguage();
  const mirror = rtl && (name === 'back' || name === 'chevron');
  return <Image accessible={false} accessibilityElementsHidden importantForAccessibility="no" source={icons[name]}
    resizeMode="contain" style={{ width: size, height: size, flexShrink: 0, tintColor: color || colors.navy, transform: [{scaleX: mirror ? -1 : 1}] }}/>;
}
const styles = StyleSheet.create({
  button: { minHeight: 48, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, flexShrink: 1, textAlign: 'center' },
});
