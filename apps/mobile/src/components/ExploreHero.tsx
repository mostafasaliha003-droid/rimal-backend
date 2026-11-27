import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { palette, space } from '../theme';
import { Txt } from './Primitives';
import { exploreGreeting } from './exploreGreeting';

/** How far the search card rises into the photograph. */
export const EXPLORE_HERO_OVERLAP = 64;

/**
 * Explore opens the way the welcome screen does: a real place under the plum veil, a greeting, and the
 * question in white. The search card rises into the photograph's lower edge, so the form stays the first
 * thing a member can act on.
 */
export default function ExploreHero({ name, rtl, gutter }: { name?: string | null; rtl: boolean; gutter: number }) {
  const align = { textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' } as const;
  return <View testID="explore-hero" style={styles.band}>
    <Image accessible={false} source={require('../../assets/explore-marina.jpg')} resizeMode="cover" style={[StyleSheet.absoluteFill, styles.photo]}/>
    <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="explore-veil" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={palette.plum900} stopOpacity="0.62"/><Stop offset="0.5" stopColor={palette.plum800} stopOpacity="0.4"/>
          <Stop offset="1" stopColor={palette.plum900} stopOpacity="0.78"/>
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#explore-veil)"/>
    </Svg>
    <View style={[styles.copy, { paddingHorizontal: gutter + space.xs }]}>
      <Txt kind="label" tone="onDarkMuted" style={align}>{exploreGreeting(new Date().getHours(), rtl ? 'ar' : 'en', name)}</Txt>
      <Txt kind="display" tone="onDark" accessibilityRole="header" style={[align, styles.title]}>{rtl ? 'إلى أين وجهتك القادمة؟' : 'Where to next?'}</Txt>
      <Txt kind="small" tone="onDark" style={[align, styles.lead]}>{rtl ? 'أسعار إجمالية لكامل الإقامة وشروط واضحة قبل أن تحجز.' : 'Full-stay prices and clear terms before you book.'}</Txt>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  band: { width: '100%', minHeight: 228, overflow: 'hidden', backgroundColor: palette.plum800, justifyContent: 'flex-start' },
  photo: { width: '100%', height: '100%' },
  copy: { paddingTop: space.lg, paddingBottom: EXPLORE_HERO_OVERLAP + space.md, gap: space.xxs },
  title: { textShadowColor: 'rgba(32, 22, 38, 0.45)', textShadowRadius: 12, textShadowOffset: { width: 0, height: 2 } },
  lead: { opacity: 0.92 },
});
