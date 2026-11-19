import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { PillowWordmark } from './BrandHeader';
import { Txt } from './Primitives';

const copy = {
  ar: {
    results: ['نبحث عن فنادق لتواريخك', 'تخيّل صباحك هناك. قهوة على مهل أم جولة مبكرة؟', 'ما زلنا ننتظر توافر الغرف والأسعار لتواريخك.'],
    hotel: ['نحضّر الغرف وشروط الإقامة', 'كل رحلة تبدأ باختيار صغير. أي غرفة ستختار؟', 'ما زلنا ننتظر تفاصيل الغرف وعروض الفندق.'],
  },
  en: {
    results: ['Finding hotels for your dates', 'Picture your first morning. A slow coffee or an early wander?', 'Still waiting for room availability and prices for your dates.'],
    hotel: ['Loading rooms and stay details', 'Every trip starts with a little choice. Which room feels like you?', 'Still waiting for room details and rates from the hotel.'],
  },
};

export default function BrandedWait({ stage }: { stage: 'results' | 'hotel' }) {
  const { language } = useLanguage();
  const { height } = useWindowDimensions();
  const [visible, setVisible] = useState(false);
  const [extended, setExtended] = useState(false);
  const [lift] = useState(() => new Animated.Value(0));
  const [title, invitation, waiting] = copy[language][stage];

  useEffect(() => {
    const reveal = setTimeout(() => setVisible(true), 300);
    const update = setTimeout(() => setExtended(true), 8000);
    return () => { clearTimeout(reveal); clearTimeout(update); };
  }, []);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    let preferenceChanged = false;
    const tween = (toValue: number) => Animated.timing(lift, {
      toValue, duration: 900, isInteraction: false, useNativeDriver: Platform.OS !== 'web',
    });
    const arrival = Animated.sequence([tween(-4), tween(0)]);
    const change = AccessibilityInfo.addEventListener('reduceMotionChanged', reduced => {
      preferenceChanged = true;
      if (reduced) { arrival.stop(); lift.setValue(0); }
    });
    AccessibilityInfo.isReduceMotionEnabled().then(reduced => {
      if (current && !preferenceChanged && !reduced) arrival.start();
    }).catch(() => {});
    return () => { current = false; change?.remove(); arrival.stop(); };
  }, [visible, lift]);

  if (!visible) return null;
  return <View testID={'brand-wait-' + stage} style={[styles.scene, { minHeight: Math.min(460, Math.max(280, height * .55)) }]}>
    <View style={styles.art} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden>
      <View style={styles.orbit}/>
      <View style={styles.disc}/>
      <View style={styles.pistachio}/><View style={styles.apricot}/>
      <Animated.View style={{ transform: [{ translateY: lift }] }}><PillowWordmark stacked/></Animated.View>
    </View>
    <View style={styles.copy} accessible accessibilityRole="progressbar" accessibilityLabel={title}
      accessibilityLiveRegion="polite" aria-live="polite">
      <Txt kind="title" style={styles.title}>{title}</Txt>
    </View>
    <Txt testID="brand-wait-message" kind="small" accessibilityLiveRegion="none" style={styles.message}>{extended ? waiting : invitation}</Txt>
  </View>;
}

const styles = StyleSheet.create({
  scene: { width: '100%', maxWidth: 640, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 20 },
  art: { width: 178, height: 147, justifyContent: 'center', alignItems: 'center', marginBottom: 21 },
  orbit: { position: 'absolute', width: 172, height: 122, borderRadius: 86, borderWidth: 1, borderColor: colors.border, transform: [{ rotate: '-18deg' }] },
  disc: { position: 'absolute', width: 128, height: 128, borderRadius: 64, backgroundColor: colors.lavenderMist },
  pistachio: { position: 'absolute', width: 19, height: 19, borderRadius: 10, top: 18, right: 8, backgroundColor: colors.pistachio },
  apricot: { position: 'absolute', width: 11, height: 11, borderRadius: 6, bottom: 18, left: 14, backgroundColor: colors.apricot },
  copy: { maxWidth: '100%' }, title: { textAlign: 'center', fontSize: 25, lineHeight: 36 },
  message: { maxWidth: 340, marginTop: 8, textAlign: 'center', color: colors.muted, fontSize: 15, lineHeight: 24 },
});
