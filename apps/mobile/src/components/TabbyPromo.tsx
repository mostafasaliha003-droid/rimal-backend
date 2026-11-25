import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useLanguage } from '../i18n';
import { color, fonts, latinFonts, palette, radius, space } from '../theme';
import { useReducedMotion } from './motion';
import { paymentChoiceCopy, tabbyPromo } from './tabbyModel';

/** Tabby's brand mint; the official logo file can replace the word mark once Tabby supplies it. */
export const TABBY_MINT = '#3EEDBF';

/** A ring arc from `start` to `end` degrees, 0 at the top, clockwise. */
function arc(cx: number, cy: number, r: number, start: number, end: number) {
  const point = (deg: number) => [cx + r * Math.sin(deg * Math.PI / 180), cy - r * Math.cos(deg * Math.PI / 180)].map(n => n.toFixed(2)).join(' ');
  return `M${point(start)} A${r} ${r} 0 ${end - start > 180 ? 1 : 0} 1 ${point(end)}`;
}
/** A crescent moon: the outer arc of a circle and a shallower inner arc between the same tips. */
function crescent(cx: number, cy: number, s: number) {
  const x = cx + 4 * s, top = cy - 8.1 * s, bottom = cy + 8.1 * s;
  return `M${x} ${top} A${9 * s} ${9 * s} 0 1 0 ${x} ${bottom} A${10 * s} ${10 * s} 0 0 1 ${x} ${top}Z`;
}

/** A tiny "tabby" word mark in Tabby's mint. */
export function TabbyMark({ small = false }: { small?: boolean }) {
  return <View accessible={false} style={[styles.mark, small && styles.markSmall]}>
    <Text allowFontScaling={false} style={[styles.markText, small && { fontSize: 11, lineHeight: 14 }]}>tabby</Text>
  </View>;
}

/**
 * The bill, cut into four: four arcs around a sleeping moon, lighting one after another
 * (today, then three more), holding full, and starting again. Still with reduced motion.
 */
export function SplitRing({ size = 60, track = 'rgba(255,255,255,0.16)', moon = palette.cream }: { size?: number; track?: string; moon?: string }) {
  const reduced = useReducedMotion();
  // One quarter lights every 650 ms, the full ring holds for three beats, then it starts again.
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setBeat(value => (value + 1) % 8), 650);
    return () => clearInterval(timer);
  }, [reduced]);
  const lit = reduced ? 4 : Math.min(beat, 4);
  const c = size / 2, r = size / 2 - 4, gap = 14, stroke = Math.max(4, size * 0.085);
  const layer = (children: React.ReactNode) => <Svg width={size} height={size} style={StyleSheet.absoluteFill}>{children}</Svg>;
  return <View accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden style={{ width: size, height: size }}>
    {layer(<>
      <Circle cx={c} cy={c} r={r} stroke={track} strokeWidth={stroke} fill="none"/>
      <Path d={crescent(c - size * 0.02, c, size / 60)} fill={moon}/>
      <Circle cx={c + size * 0.17} cy={c - size * 0.13} r={size * 0.022} fill={TABBY_MINT}/>
      <Circle cx={c + size * 0.12} cy={c + size * 0.16} r={size * 0.016} fill={moon} opacity={0.7}/>
    </>)}
    {layer(<>{[0, 1, 2, 3].map(index => <Path key={index} d={arc(c, c, r, index * 90 + gap / 2, index * 90 + 90 - gap / 2)}
      stroke={TABBY_MINT} strokeOpacity={index < lit ? 1 : 0} strokeWidth={stroke} strokeLinecap="round" fill="none"/>)}</>)}
  </View>;
}

/** A pie that fills by quarters: 1 of 4, 2 of 4 … for the instalment schedule. */
function Quarter({ filled, size = 26 }: { filled: number; size?: number }) {
  const c = size / 2, r = size / 2 - 1.5;
  const inner = r - 2.5, end = filled * 90;
  const point = (deg: number) => `${(c + inner * Math.sin(deg * Math.PI / 180)).toFixed(2)} ${(c - inner * Math.cos(deg * Math.PI / 180)).toFixed(2)}`;
  return <Svg width={size} height={size} accessible={false}>
    <Circle cx={c} cy={c} r={r} fill={color.bgSurface} stroke={palette.plum800} strokeWidth={1.5}/>
    {filled >= 4 ? <Circle cx={c} cy={c} r={inner} fill={TABBY_MINT}/>
      : <Path d={`M${c} ${c} L${point(0)} A${inner} ${inner} 0 ${end > 180 ? 1 : 0} 1 ${point(end)} Z`} fill={TABBY_MINT}/>}
  </Svg>;
}

/** Pay in 4 as a timeline: today's share, then three more of the same amount. */
export function TabbySchedule({ amount }: { amount: string }) {
  const { language } = useLanguage();
  const labels = paymentChoiceCopy(language).schedule;
  return <View testID="checkout-tabby-schedule" style={styles.schedule} accessible accessibilityLabel={labels.map(label => `${label}: AED ${amount}`).join('، ')}>
    <View style={styles.scheduleLine}/>
    {labels.map((label, index) => <View key={label} style={styles.scheduleStep}>
      <Quarter filled={index + 1}/>
      <Text allowFontScaling style={[styles.scheduleAmount, { fontFamily: latinFonts.bold }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{amount}</Text>
      <Text allowFontScaling style={[styles.scheduleLabel, { fontFamily: language === 'ar' ? fonts.medium : latinFonts.medium }, index === 0 && { color: palette.plum800 }]} numberOfLines={1}>{label}</Text>
    </View>)}
  </View>;
}

/** The welcome front's instalment card: a joke, the plans, and who decides. */
export default function TabbyPromo({ compact = false }: { compact?: boolean }) {
  const { language, rtl } = useLanguage();
  const ar = language === 'ar';
  const copy = tabbyPromo(language);
  return <View testID="welcome-tabby" style={[styles.promo, compact && { paddingVertical: space.sm }]} accessible accessibilityLabel={`${copy.title} ${copy.body} ${copy.fine}`}>
    <Svg pointerEvents="none" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <Defs><RadialGradient id="tabby-promo-glow" cx={rtl ? "88%" : "12%"} cy="50%" r="60%">
        <Stop offset="0" stopColor={TABBY_MINT} stopOpacity="0.2"/><Stop offset="1" stopColor={TABBY_MINT} stopOpacity="0"/>
      </RadialGradient></Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#tabby-promo-glow)"/>
    </Svg>
    <SplitRing size={compact ? 48 : 60}/>
    <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
      <Text style={[styles.title, { fontFamily: ar ? fonts.bold : latinFonts.bold, fontSize: compact ? 14 : 15.5 }]}>{copy.title}</Text>
      <Text style={[styles.body, { fontFamily: ar ? fonts.regular : latinFonts.regular, fontSize: compact ? 12 : 13, lineHeight: compact ? 18 : 20 }]}>{copy.body}</Text>
      <View style={styles.footer}>
        <TabbyMark small/>
        <Text style={[styles.fine, { fontFamily: ar ? fonts.regular : latinFonts.regular }]}>{copy.fine}</Text>
      </View>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  mark: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: radius.xs, backgroundColor: TABBY_MINT, alignSelf: 'flex-start' },
  markSmall: { paddingHorizontal: 6, paddingVertical: 1 },
  markText: { color: '#000000', fontFamily: latinFonts.bold, fontSize: 14, lineHeight: 18, writingDirection: 'ltr', letterSpacing: -0.2 },
  promo: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.md, paddingVertical: space.md, borderRadius: 22, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(62,237,191,0.32)' },
  title: { color: palette.cream, lineHeight: 22 },
  body: { color: palette.lavender100 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space.xs, marginTop: 2 },
  fine: { color: palette.lavender300, fontSize: 11, lineHeight: 15, flexShrink: 1 },
  schedule: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.xs, paddingBottom: space.xxs },
  scheduleLine: { position: 'absolute', top: space.xs + 12, start: '12%', end: '12%', height: 2, borderRadius: 1, backgroundColor: color.border },
  scheduleStep: { flex: 1, alignItems: 'center', gap: 4 },
  scheduleAmount: { color: color.textPrimary, fontSize: 12.5, lineHeight: 17, writingDirection: 'ltr' },
  scheduleLabel: { color: color.textSecondary, fontSize: 11.5, lineHeight: 16 },
});
