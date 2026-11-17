import React, { useState } from 'react';
import { ActivityIndicator, ColorValue, Image, Pressable, StyleSheet, Text, TextInput, TextInputProps, TextProps, View, ViewStyle } from 'react-native';
import { colors, fonts, tokens, ui } from '../theme';
import { useLanguage } from '../i18n';
import type { Money } from '../types';

export function Txt({ children, style, kind = 'text', ...props }: TextProps & { kind?: 'text'|'small'|'label'|'heading'|'title' }) {
  const { rtl } = useLanguage();
  return <Text {...props} style={[ui[kind], { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }, style]}>{children}</Text>;
}
export function Row({ children, style }: { children: React.ReactNode; style?: ViewStyle }) { const { rtl } = useLanguage(); return <View style={[ui.row, { flexDirection: rtl ? 'row-reverse' : 'row' }, style]}>{children}</View>; }
export function Button({ title, onPress, variant = 'primary', disabled = false, busy = false, hint, label, compact = false }: { title: string; onPress: () => void; variant?: 'primary'|'secondary'|'quiet'|'danger'; disabled?: boolean; busy?: boolean; hint?: string; label?: string; compact?: boolean }) {
  const foreground = variant === 'primary' || variant === 'danger' ? '#fff' : colors.navy;
  return <Pressable accessibilityRole="button" accessibilityLabel={label || title} accessibilityHint={hint} accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress} style={({ pressed }) => [styles.button, compact && { paddingHorizontal: 12, minHeight: tokens.control.minHeight, minWidth: tokens.control.minHeight }, variant === 'primary' ? { backgroundColor: colors.navy } : variant === 'danger' ? { backgroundColor: colors.red } : { backgroundColor: variant === 'quiet' ? 'transparent' : '#fff', borderColor: colors.border, borderWidth: variant === 'quiet' ? 0 : 1 }, { opacity: disabled || busy ? .5 : pressed ? .75 : 1 }]}>
    {busy && <ActivityIndicator color={foreground} />}<Text style={[styles.buttonText, { color: foreground }]}>{title}</Text>
  </Pressable>;
}
export function Field({ label, error, style, ltr = false, ...props }: TextInputProps & { label: string; error?: string; ltr?: boolean }) {
  const { rtl } = useLanguage(); const [focused, focus] = useState(false);
  return <View style={{ gap: 6, flexShrink: 1 }}><Txt kind="label">{label}</Txt><TextInput {...props} accessibilityLabel={label} accessibilityHint={error || props.accessibilityHint} placeholderTextColor={colors.muted} onFocus={event => { focus(true); props.onFocus?.(event); }} onBlur={event => { focus(false); props.onBlur?.(event); }} style={[ui.input, { textAlign: ltr ? 'left' : rtl ? 'right' : 'left', writingDirection: ltr ? 'ltr' : rtl ? 'rtl' : 'ltr', borderColor: error ? colors.red : focused ? colors.blueStrong : colors.border }, style]} />{error && <Txt accessibilityRole="alert" style={{ color: colors.red }} kind="small">{error}</Txt>}</View>;
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
export function Icon({ name, color = colors.navy, size = 24 }: { name: 'search'|'saved'|'account'|'support'; color?: ColorValue | null; size?: number }) {
  color = color || colors.navy;
  if (name === 'search') return <View accessible={false} style={{ width: size, height: size }}><View style={{ width: size*.65, height: size*.65, borderRadius: size, borderWidth: 2, borderColor: color, left: 1, top: 1 }} /><View style={{ width: size*.4, height: 2, backgroundColor: color, transform: [{ rotate: '45deg' }], position: 'absolute', right: 0, bottom: 4 }} /></View>;
  if (name === 'account') return <View accessible={false} style={{ width: size, height: size, alignItems: 'center', gap: 3 }}><View style={{ width: size*.4, height: size*.4, borderRadius: size, borderWidth: 2, borderColor: color }} /><View style={{ width: size*.8, height: size*.42, borderTopLeftRadius: size, borderTopRightRadius: size, borderWidth: 2, borderColor: color }} /></View>;
  return <Text accessible={false} style={{ color, fontSize: size + 2, lineHeight: size + 4 }}>{name === 'saved' ? '♡' : '?'}</Text>;
}
const styles = StyleSheet.create({ button: { minHeight: 54, borderRadius: 15, paddingHorizontal: 20, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 }, buttonText: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, textAlign: 'center' } });
