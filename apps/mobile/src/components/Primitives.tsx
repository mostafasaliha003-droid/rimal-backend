import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { DimensionValue, PressableStateCallbackType, StyleProp, TextInputProps, TextProps, TextStyle, ViewProps, ViewStyle } from 'react-native';
import { border, color, elevation, fonts, layout, localizedFont, radius, space, touch, typeStyle, ui, type TypeVariant } from '../theme';
import { useLanguage } from '../i18n';
import type { Money } from '../types';
import { Icon, type IconName } from './Icon';
import { formatMoney } from './format';
import { useReducedMotion } from './motion';

export { Icon } from './Icon';
export type { IconName } from './Icon';

type LegacyKind = 'text' | 'small' | 'label' | 'heading' | 'title';
export type TextKind = LegacyKind | TypeVariant;
export type Tone = 'primary' | 'secondary' | 'brand' | 'link' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'onDark' | 'onDarkMuted' | 'price';
const legacyKinds: Record<LegacyKind, TypeVariant> = { text: 'body', small: 'small', label: 'label', heading: 'heading', title: 'title' };
const defaultTone: Record<TypeVariant, Tone> = { display: 'brand', title: 'brand', heading: 'brand', subheading: 'brand', body: 'primary',
  bodyStrong: 'primary', label: 'brand', small: 'secondary', caption: 'secondary', micro: 'secondary', price: 'price', priceLarge: 'price' };
export const toneColor: Record<Tone, string> = { primary: color.textPrimary, secondary: color.textSecondary, brand: color.textBrand,
  link: color.textLink, success: color.success, warning: color.warning, danger: color.danger, info: color.info, accent: color.accent,
  onDark: color.textOnDark, onDarkMuted: color.textOnDarkMuted, price: color.price };
const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);
/** WCAG 2.5.3 Label in Name: a control's accessible name always contains its visible text. */
export function nameWithVisibleText(visible: string, label?: string) {
  if (!label || label === visible || label.includes(visible)) return label || visible;
  return visible.includes(label) ? visible : `${visible} · ${label}`;
}

/** Text that follows the type scale, reading direction and the script's line-height needs. */
export function Txt({ children, style, kind = 'text', tone, align, ...props }: TextProps & { kind?: TextKind; tone?: Tone; align?: 'start' | 'center' | 'end' }) {
  const { rtl, language } = useLanguage();
  const variant = (legacyKinds as Record<string, TypeVariant>)[kind] ?? kind as TypeVariant;
  const base = typeStyle(variant, language);
  const flat = (StyleSheet.flatten(style) || {}) as TextStyle;
  const fontFamily = flat.fontFamily ? localizedFont(language, flat.fontFamily) : base.fontFamily;
  const fontSize = flat.fontSize ?? base.fontSize;
  let lineHeight = flat.lineHeight ?? base.lineHeight;
  // Arabic diacritics clip below ~1.45x; raise tight legacy line heights automatically.
  if (language === 'ar' && lineHeight < fontSize * 1.45) lineHeight = Math.ceil(fontSize * 1.5);
  const right = rtl ? align !== 'end' : align === 'end';
  return <Text {...props} style={[base, { color: toneColor[tone ?? defaultTone[variant]], textAlign: align === 'center' ? 'center' : right ? 'right' : 'left',
    writingDirection: rtl ? 'rtl' : 'ltr' }, style, { fontFamily, lineHeight }]}>{children}</Text>;
}

/** A horizontal row that mirrors in right-to-left layouts. */
export function Row({ children, style, ...props }: ViewProps & { style?: StyleProp<ViewStyle> }) {
  const { rtl } = useLanguage();
  return <View {...props} style={[ui.row, { flexDirection: rtl ? 'row-reverse' : 'row' }, style]}>{children}</View>;
}

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'tonal';
const buttonColors: Record<ButtonVariant, { bg: string; pressed: string; hover: string; fg: string; border?: string }> = {
  primary: { bg: color.actionPrimary, pressed: color.actionPrimaryPressed, hover: color.actionPrimaryHover, fg: color.onActionPrimary },
  secondary: { bg: color.actionSecondary, pressed: color.actionSecondaryPressed, hover: color.bgMuted, fg: color.onActionSecondary, border: color.borderControl },
  quiet: { bg: 'transparent', pressed: color.bgSelected, hover: color.bgMuted, fg: color.interactiveStrong },
  danger: { bg: color.danger, pressed: '#8A2230', hover: '#952634', fg: color.textOnDark },
  tonal: { bg: color.bgSelected, pressed: '#E7DBFA', hover: '#EEE4FC', fg: color.textBrand },
};

export function Button({ title, onPress, variant = 'primary', disabled = false, busy = false, hint, label, compact = false, size, icon, iconEnd, testID, fill = false }: {
  title: string; onPress: () => void; variant?: ButtonVariant; disabled?: boolean; busy?: boolean; hint?: string; label?: string;
  compact?: boolean; size?: 'sm' | 'md' | 'lg'; icon?: IconName; iconEnd?: IconName; testID?: string; fill?: boolean;
}) {
  const { language, rtl } = useLanguage();
  const palette = buttonColors[variant];
  const scale = size ?? (compact ? 'sm' : 'md');
  const minHeight = scale === 'lg' ? 56 : scale === 'sm' ? touch.min : Math.max(touch.min, 48);
  const inactive = disabled || busy;
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={nameWithVisibleText(title, label)} accessibilityHint={hint}
    accessibilityState={{ disabled: inactive, busy }} aria-busy={busy} disabled={inactive} onPress={onPress}
    style={state => [styles.button, { minHeight, paddingHorizontal: scale === 'sm' ? space.md : scale === 'lg' ? space.xl : space.lg,
      flexDirection: rtl ? 'row-reverse' : 'row', backgroundColor: state.pressed ? palette.pressed : hovered(state) ? palette.hover : palette.bg },
    palette.border ? { borderWidth: 1, borderColor: palette.border } : null, fill && styles.fill, inactive && styles.inactive,
    state.pressed && !inactive && styles.pressed]}>
    {busy ? <ActivityIndicator size="small" color={palette.fg}/> : icon ? <Icon name={icon} size={scale === 'lg' ? 20 : 18} color={palette.fg}/> : null}
    <Text numberOfLines={2} style={[typeStyle('label', language), styles.buttonText, { color: palette.fg, fontSize: scale === 'lg' ? 17 : 16,
      fontFamily: localizedFont(language, fonts.bold) }]}>{title}</Text>
    {iconEnd && !busy && <Icon name={iconEnd} size={18} color={palette.fg}/>}
  </Pressable>;
}

/** Icon-only control. `label` is required: it is the control's accessible name. */
export function IconButton({ icon, label, onPress, selected, disabled = false, variant = 'plain', size = 20, testID, hint, filled, iconColor }: {
  icon: IconName; label: string; onPress: () => void; selected?: boolean; disabled?: boolean; variant?: 'plain' | 'outline' | 'onPhoto' | 'tonal';
  size?: number; testID?: string; hint?: string; filled?: boolean; iconColor?: string;
}) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={selected === undefined ? { disabled } : { disabled, selected }} aria-pressed={selected} disabled={disabled} onPress={onPress}
    hitSlop={4} style={state => [styles.iconButton, variant === 'outline' && styles.iconOutline, variant === 'onPhoto' && [styles.iconOnPhoto, elevation.card],
      variant === 'tonal' && { backgroundColor: color.bgSelected },
      (state.pressed || hovered(state)) && { backgroundColor: variant === 'onPhoto' ? color.bgSelected : color.bgMuted },
      disabled && styles.inactive, state.pressed && styles.pressed]}>
    <Icon name={icon} size={size} filled={filled} color={iconColor || (selected ? color.interactive : color.textBrand)}/>
  </Pressable>;
}

/** Filter/choice chip. With `onRemove` it becomes an active filter that removes itself. */
export function Chip({ label, selected = false, onPress, onRemove, icon, accessibilityLabel, testID, role = 'button', size = 'md' }: {
  label: string; selected?: boolean; onPress?: () => void; onRemove?: () => void; icon?: IconName; accessibilityLabel?: string;
  testID?: string; role?: 'button' | 'checkbox' | 'radio'; size?: 'sm' | 'md';
}) {
  const small = size === 'sm';
  const { rtl } = useLanguage();
  const removable = Boolean(onRemove);
  const active = selected || removable;
  const checked = role === 'checkbox' || role === 'radio';
  return <Pressable testID={testID} accessibilityRole={role} accessibilityLabel={nameWithVisibleText(label, accessibilityLabel)}
    accessibilityState={checked ? { checked: selected } : role === 'button' && !removable ? { selected } : undefined}
    aria-checked={checked ? selected : undefined} aria-pressed={role === 'button' && !removable ? selected : undefined}
    onPress={onRemove || onPress} hitSlop={small ? { top: (touch.min - 36) / 2, bottom: (touch.min - 36) / 2 } : undefined}
    style={state => [styles.chip, small && styles.chipSmall, { flexDirection: rtl ? 'row-reverse' : 'row' },
      active && styles.chipActive, (state.pressed || hovered(state)) && { backgroundColor: active ? '#EADFFB' : color.bgMuted }]}>
    {icon && !removable && <Icon name={icon} size={16} color={active ? color.interactiveStrong : color.textBrand}/>}
    {selected && !removable && !icon && <Icon name="check" size={16} color={color.interactiveStrong}/>}
    <Txt kind="label" numberOfLines={1} style={{ color: active ? color.interactiveStrong : color.textBrand, flexShrink: 1 }}>{label}</Txt>
    {removable && <Icon name="close" size={16} color={color.interactiveStrong}/>}
  </Pressable>;
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent' | 'brand';
const badgeColors: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: color.bgSubtle, fg: color.textSecondary }, success: { bg: color.successBg, fg: color.success },
  warning: { bg: color.warningBg, fg: color.warning }, danger: { bg: color.dangerBg, fg: color.danger },
  info: { bg: color.infoBg, fg: color.info }, accent: { bg: color.accentBg, fg: color.accent }, brand: { bg: color.bgBrand, fg: color.textOnDark },
};
export function Badge({ label, tone = 'neutral', icon, testID }: { label: string; tone?: BadgeTone; icon?: IconName; testID?: string }) {
  const { rtl } = useLanguage();
  const palette = badgeColors[tone];
  return <View testID={testID} style={[styles.badge, { backgroundColor: palette.bg, flexDirection: rtl ? 'row-reverse' : 'row', alignSelf: rtl ? 'flex-end' : 'flex-start' }]}>
    {icon && <Icon name={icon} size={14} color={palette.fg}/>}
    <Txt kind="micro" style={{ color: palette.fg, flexShrink: 1 }}>{label}</Txt>
  </View>;
}

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'neutral';
const noticeColors: Record<NoticeTone, { bg: string; fg: string; border: string; icon: IconName }> = {
  info: { bg: color.infoBg, fg: color.info, border: color.infoBorder, icon: 'info' },
  success: { bg: color.successBg, fg: color.success, border: color.successBorder, icon: 'checkCircle' },
  warning: { bg: color.warningBg, fg: color.warning, border: color.warningBorder, icon: 'alert' },
  danger: { bg: color.dangerBg, fg: color.danger, border: color.dangerBorder, icon: 'alertCircle' },
  accent: { bg: color.accentBg, fg: color.accent, border: color.accentBorder, icon: 'sparkles' },
  neutral: { bg: color.bgSubtle, fg: color.textSecondary, border: color.border, icon: 'info' },
};
/** Inline message: what happened, then what the traveler can do now. */
export function Notice({ tone = 'info', title, body, icon, action, children, live = false, testID }: {
  tone?: NoticeTone; title?: string; body?: string; icon?: IconName; action?: { label: string; onPress: () => void; busy?: boolean };
  children?: React.ReactNode; live?: boolean; testID?: string;
}) {
  const palette = noticeColors[tone];
  return <View testID={testID} accessibilityRole={tone === 'danger' && live ? 'alert' : undefined} accessibilityLiveRegion={live ? 'polite' : undefined}
    style={[styles.notice, { backgroundColor: palette.bg, borderColor: palette.border }]}>
    <Row style={{ alignItems: 'flex-start', gap: space.sm }}>
      <View style={{ paddingTop: 2 }}><Icon name={icon || palette.icon} size={18} color={palette.fg}/></View>
      <View style={{ flex: 1, minWidth: 0, gap: space.xxs }}>
        {title && <Txt kind="label" style={{ color: palette.fg }}>{title}</Txt>}
        {body && <Txt kind="small" tone="primary">{body}</Txt>}
        {children}
      </View>
    </Row>
    {action && <View style={{ alignSelf: 'stretch' }}><Button compact variant="secondary" title={action.label} busy={action.busy} onPress={action.onPress}/></View>}
  </View>;
}

export function Card({ children, style, elevated = false, padded = true, testID, ...props }: ViewProps & {
  children?: React.ReactNode; style?: StyleProp<ViewStyle>; elevated?: boolean; padded?: boolean;
}) {
  return <View testID={testID} {...props} style={[styles.card, !padded && { padding: 0 }, elevated && elevation.card, style]}>{children}</View>;
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) { return <View style={[ui.rule, style]}/>; }

/** Expand/collapse indicator for disclosure rows (the row itself carries aria-expanded). */
export function DisclosureMark({ open, color: tint = color.interactiveStrong }: { open: boolean; color?: string }) {
  return <View accessible={false} style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}><Icon name="chevronDown" size={18} color={tint}/></View>;
}

export function SectionHeader({ title, action, subtitle, testID }: { title: string; subtitle?: string; action?: { label: string; onPress: () => void }; testID?: string }) {
  return <Row testID={testID} style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: space.sm, flexWrap: 'wrap' }}>
    <View style={{ flex: 1, minWidth: 160, gap: space.xxs }}>
      <Txt kind="heading" accessibilityRole="header">{title}</Txt>
      {subtitle && <Txt kind="small">{subtitle}</Txt>}
    </View>
    {action && <Button compact variant="quiet" title={action.label} onPress={action.onPress}/>}
  </Row>;
}

/** Placeholder with a fixed footprint, so content never jumps when data arrives. */
export function Skeleton({ width = '100%', height = 16, rounded = radius.sm, style }: { width?: DimensionValue; height?: DimensionValue; rounded?: number; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const [pulse] = useState(() => new Animated.Value(0.55));
  useEffect(() => {
    if (reduced) { pulse.setValue(0.7); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [pulse, reduced]);
  return <Animated.View accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden
    style={[{ width, height, borderRadius: rounded, backgroundColor: color.bgSelected, opacity: pulse }, style]}/>;
}

export function Field({ label, error, errorId, inputRef, style, ltr = false, hint, a11yLabel, ...props }: TextInputProps & {
  label: string; error?: string; errorId?: string; inputRef?: React.Ref<React.ComponentRef<typeof TextInput>>; ltr?: boolean; hint?: string;
  /** Full accessible name when the visible label relies on nearby context ("First name" under "Room 2 · Traveler 1"). */
  a11yLabel?: string;
}) {
  const { rtl, language } = useLanguage(); const [focused, focus] = useState(false);
  const errorLink = Platform.OS === 'web' && error && errorId ? { 'aria-invalid': true, 'aria-describedby': errorId } : undefined;
  return <View style={{ gap: space.xs, flexShrink: 1 }}>
    <Txt kind="label">{label}</Txt>
    <View style={[styles.fieldRing, { borderColor: focused ? color.focusRing : 'transparent' }]}>
      <TextInput {...props} {...errorLink} ref={inputRef} accessibilityLabel={a11yLabel ? nameWithVisibleText(label, a11yLabel) : label} accessibilityHint={error || hint || props.accessibilityHint}
        placeholderTextColor={color.textSecondary}
        onFocus={event => { focus(true); props.onFocus?.(event); }} onBlur={event => { focus(false); props.onBlur?.(event); }}
        style={[ui.input, { fontFamily: localizedFont(language, fonts.medium), textAlign: ltr ? 'left' : rtl ? 'right' : 'left',
          writingDirection: ltr ? 'ltr' : rtl ? 'rtl' : 'ltr', borderColor: error ? color.danger : focused ? color.interactive : color.borderControl },
          Platform.OS === 'web' && ({ outlineStyle: 'none' } as object), style]}/>
    </View>
    {hint && !error && <Txt kind="caption">{hint}</Txt>}
    {error && <Row style={{ gap: space.xs, alignItems: 'flex-start' }}>
      <View style={{ paddingTop: 2 }}><Icon name="alertCircle" size={16} color={color.danger}/></View>
      <Txt nativeID={errorId} accessibilityRole="alert" kind="small" style={{ color: color.danger, flex: 1 }}>{error}</Txt>
    </Row>}
  </View>;
}

/**
 * Supplier photograph with a reserved footprint: the frame keeps its height while the
 * image loads (no layout shift), fades in unless motion is reduced, and falls back
 * to the next supplied photo or an honest "unavailable" panel.
 */
export function Photo({ uri, alternatives = [], label, room = false, height = 210, thumbnail = false, contain = false, onFailed }: {
  uri?: string; alternatives?: readonly string[]; label: string; room?: boolean; height?: number | '100%';
  thumbnail?: boolean; contain?: boolean; onFailed?: (uri: string) => void;
}) {
  const { t, language } = useLanguage();
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const [loaded, setLoaded] = useState<string | null>(null);
  const [opacity] = useState(() => new Animated.Value(0));
  const source = uri && !failed.has(uri) ? uri : alternatives.find(item => !failed.has(item));
  if (source) return <View style={{ width: '100%', height, backgroundColor: contain ? color.textPrimary : color.photoPlaceholder, overflow: 'hidden' }}>
    {loaded !== source && !thumbnail && <View style={styles.photoWaiting} accessible={false}><Icon name={room ? 'bed' : 'image'} size={24} color={color.borderControl}/></View>}
    <Animated.Image key={source} accessibilityLabel={label} source={{ uri: source }} resizeMode={contain ? 'contain' : 'cover'}
      onLoad={() => {
        setLoaded(source);
        if (reduced) opacity.setValue(1);
        else Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: Platform.OS !== 'web' }).start();
      }}
      onError={() => { setFailed(previous => new Set(previous).add(source)); onFailed?.(source); }}
      style={{ width: '100%', height: '100%', opacity: loaded === source ? opacity : 0 }}/>
  </View>;
  const caption = (uri || alternatives.length) ? (language === 'ar' ? 'تعذّر تحميل الصورة' : 'Photo unavailable')
    : t(room ? 'roomPhotoUnknown' : 'photoUnknown');
  return <View accessible accessibilityLabel={caption} style={{ height, alignItems: 'center', justifyContent: 'center',
    backgroundColor: color.photoPlaceholder, padding: thumbnail ? space.xs : space.md, gap: space.xs }}>
    <Icon name={room ? 'bed' : 'image'} size={thumbnail ? 18 : 24} color={color.textSecondary}/>
    {!thumbnail && (uri || alternatives.length > 0) && <Txt kind="caption" align="center">{caption}</Txt>}
  </View>;
}

/** Customer price exactly as supplied, grouped for reading ("AED 1,234.50"). */
export function MoneyText({ money, large = false, style, testID }: { money: Money | null | undefined; large?: boolean; style?: StyleProp<TextStyle>; testID?: string }) {
  const { t } = useLanguage();
  const text = formatMoney(money);
  if (!text) return <Txt kind="small" testID={testID}>{t('priceUnknown')}</Txt>;
  return <Txt testID={testID} kind={large ? 'priceLarge' : 'price'} style={style}>{text}</Txt>;
}

/** Full-width state: icon, what happened, what to do next. */
export function StatePanel({ title, body, retry, busy = false, icon, tone = 'neutral', children, testID }: {
  title: string; body?: string; retry?: () => void; busy?: boolean; icon?: IconName; tone?: 'neutral' | 'info' | 'warning' | 'danger' | 'success';
  children?: React.ReactNode; testID?: string;
}) {
  const { t } = useLanguage();
  const palette = tone === 'neutral' ? { bg: color.bgSelected, fg: color.interactiveStrong } : { bg: noticeColors[tone].bg, fg: noticeColors[tone].fg };
  return <View testID={testID} style={[ui.card, styles.state]}>
    {busy ? <ActivityIndicator size="large" color={color.interactive}/> : icon ? <View style={[styles.stateIcon, { backgroundColor: palette.bg }]}>
      <Icon name={icon} size={26} color={palette.fg}/></View> : null}
    <Txt kind="heading" align="center" accessibilityRole={busy ? 'text' : 'header'}>{title}</Txt>
    {body && <Txt kind="body" tone="secondary" align="center">{body}</Txt>}
    {children}
    {retry && <Button variant="secondary" icon="refresh" title={t('retry')} onPress={retry}/>}
  </View>;
}


/** One fact on one line: a quiet icon and its text. The building block of flat summaries. */
export function InfoRow({ icon, children, tone, testID, iconColor }: { icon: IconName; children: React.ReactNode; tone?: string; testID?: string; iconColor?: string }) {
  return <Row testID={testID} style={{ gap: space.sm, alignItems: 'flex-start' }}>
    <View style={{ paddingTop: 3 }}><Icon name={icon} size={16} color={iconColor || tone || color.textSecondary}/></View>
    <View style={{ flex: 1, minWidth: 0, gap: 1 }}>{children}</View>
  </Row>;
}

/** An inline text action with a full touch target ("Details", "Full schedule"). */
export function TextLink({ title, onPress, testID, label, icon }: { title: string; onPress: () => void; testID?: string; label?: string; icon?: IconName }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={nameWithVisibleText(title, label)} onPress={onPress} hitSlop={{ top: 8, bottom: 8 }}
    style={state => [styles.link, (state.pressed || hovered(state)) && { opacity: 0.7 }]}>
    <Row style={{ gap: space.xxs }}>
      <Txt kind="label" tone="link">{title}</Txt>
      {icon && <Icon name={icon} size={16} color={color.textLink}/>}
    </Row>
  </Pressable>;
}

/**
 * Bottom sheet for details that would otherwise lengthen the page: full cancellation
 * schedules, every tax line. A dialog on wide windows. Closing never loses the page.
 */
export function Sheet({ visible, title, subtitle, onClose, children, testID, closeLabel }: {
  visible: boolean; title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; testID?: string; closeLabel?: string;
}) {
  const { language } = useLanguage();
  const { width, height } = useWindowDimensions();
  const wide = width >= layout.breakpoints.expanded;
  if (!visible) return null;
  return <Modal visible transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={onClose}>
    <View style={[styles.scrim, wide && { justifyContent: 'center', padding: space.xl }]}>
      <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill}/>
      <SafeAreaView edges={['bottom']} accessibilityViewIsModal testID={testID}
        style={[styles.sheet, wide && styles.sheetDialog, { maxHeight: Math.max(240, height * (wide ? 0.86 : 0.9)) }, elevation.overlay]}>
        {!wide && <View style={styles.sheetHandle}/>}
        <Row style={styles.sheetHeader}>
          <View style={{ flex: 1, minWidth: 0, paddingHorizontal: space.sm }}>
            <Txt kind="subheading" accessibilityRole="header">{title}</Txt>
            {!!subtitle && <Txt kind="caption" numberOfLines={2}>{subtitle}</Txt>}
          </View>
          <IconButton icon="close" label={closeLabel || (language === 'ar' ? 'إغلاق' : 'Close')} onPress={onClose} testID={testID ? testID + '-close' : undefined}/>
        </Row>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>{children}</ScrollView>
      </SafeAreaView>
    </View>
  </Modal>;
}

/**
 * The fixed bottom bar of a booking step: what it costs, and the one thing to do next.
 * `stacked` puts a long action under the price instead of beside it, so its label is
 * never cut off.
 */
export function ActionBar({ caption, amount, note, children, stacked = false, testID, amountTestID, maxWidth }: {
  caption?: string; amount?: string | null; note?: string; children: React.ReactNode; stacked?: boolean; testID?: string; amountTestID?: string; maxWidth?: number;
}) {
  const price = (caption || amount || note) ? <View style={stacked ? styles.barPriceRow : styles.barPrice}>
    {stacked ? <Row style={{ justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' }}>
      {!!caption && <Txt kind="caption" style={{ flexShrink: 1 }}>{caption}</Txt>}
      <View style={{ flexShrink: 0 }}>
        {!!amount && <Txt testID={amountTestID} kind="subheading" align="end" style={styles.barAmount}>{amount}</Txt>}
      </View>
    </Row> : <>
      {!!caption && <Txt kind="caption" numberOfLines={1}>{caption}</Txt>}
      {!!amount && <Txt testID={amountTestID} kind="subheading" numberOfLines={1} style={styles.barAmount}>{amount}</Txt>}
    </>}
    {!!note && <Txt kind="caption" numberOfLines={1} align={stacked ? 'end' : undefined}>{note}</Txt>}
  </View> : null;
  return <View testID={testID} style={[styles.bar, elevation.raised]}>
    {stacked ? <View style={[styles.barInner, { maxWidth: maxWidth ?? layout.maxReading, gap: space.sm }]}>{price}{children}</View>
      : <Row style={[styles.barInner, { maxWidth: maxWidth ?? layout.maxReading }]}>{price}<View style={styles.barAction}>{children}</View></Row>}
  </View>;
}

/** Legacy image helper kept for the brand symbol (approved raster asset). */
export function BrandImage({ source, size }: { source: number; size: number }) {
  return <Image accessible={false} source={source} resizeMode="contain" style={{ width: size, height: size }}/>;
}

const styles = StyleSheet.create({
  button: { borderRadius: radius.md, paddingVertical: space.sm, alignItems: 'center', justifyContent: 'center', gap: space.sm },
  buttonText: { flexShrink: 1, textAlign: 'center' },
  fill: { alignSelf: 'stretch', flexGrow: 1 },
  inactive: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.98 }] },
  iconButton: { minWidth: touch.min, minHeight: touch.min, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  iconOutline: { borderWidth: 1, borderColor: color.border, backgroundColor: color.bgSurface },
  iconOnPhoto: { backgroundColor: 'rgba(255,255,255,0.94)', minWidth: 40, minHeight: 40, margin: 2 },
  chip: { minHeight: touch.min, maxWidth: '100%', alignItems: 'center', gap: space.xs, paddingHorizontal: space.md, borderRadius: radius.pill,
    borderWidth: 1, borderColor: color.borderControl, backgroundColor: color.bgSurface },
  chipActive: { borderColor: color.borderSelected, backgroundColor: color.bgSelected },
  chipSmall: { minHeight: 36, paddingHorizontal: space.md - 2 },
  link: { minHeight: 32, justifyContent: 'center', alignSelf: 'flex-start' },
  scrim: { flex: 1, justifyContent: 'flex-end', backgroundColor: color.scrim },
  sheet: { width: '100%', maxWidth: layout.maxSheet, alignSelf: 'center', backgroundColor: color.bgSurface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, direction: 'ltr' },
  sheetDialog: { borderRadius: radius.xl },
  sheetHandle: { alignSelf: 'center', marginTop: space.sm, width: 40, height: 4, borderRadius: 2, backgroundColor: color.border },
  sheetHeader: { paddingHorizontal: space.xs, paddingVertical: space.xs, gap: space.sm, borderBottomWidth: 1, borderColor: color.border },
  sheetBody: { padding: space.lg, gap: space.md, paddingBottom: space.xl },
  bar: { backgroundColor: color.bgSurface, borderTopWidth: 1, borderTopColor: color.border },
  barInner: { width: '100%', alignSelf: 'center', paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.md, alignItems: 'center' },
  barPrice: { flex: 1, minWidth: 0 },
  barPriceRow: { alignSelf: 'stretch' },
  barAction: { flexShrink: 1, maxWidth: '62%' },
  barAmount: { writingDirection: 'ltr' },
  badge: { alignItems: 'center', gap: space.xs, paddingHorizontal: space.sm, paddingVertical: space.xxs, borderRadius: radius.sm, maxWidth: '100%' },
  notice: { borderRadius: radius.md, borderWidth: 1, padding: space.md, gap: space.md },
  card: { backgroundColor: color.bgSurface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: color.border, gap: space.md },
  fieldRing: { borderWidth: border.focus, borderRadius: radius.md + 2, margin: -border.focus },
  photoWaiting: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center' },
  state: { alignItems: 'center', paddingVertical: space.xl, gap: space.md },
  stateIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
