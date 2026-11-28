import React, { useEffect, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useLanguage } from '../i18n';
import { color, fonts, latinFonts, palette, radius, space } from '../theme';
import { Button, Icon, Row, Txt } from '../components/Primitives';
import type { IconName } from '../components/Primitives';
import { useReducedMotion } from '../components/motion';
import { haptic } from '../components/haptics';
import { TabbyBanner } from '../components/TabbyPromo';

const native = Platform.OS !== 'web';
const hovered = (state: PressableStateCallbackType) => Boolean((state as { hovered?: boolean }).hovered);
const AnimatedCircle = Animated.createAnimatedComponent(Circle) as unknown as React.ComponentType<Omit<React.ComponentProps<typeof Circle>, 'strokeDashoffset'> & { strokeDashoffset?: Animated.AnimatedInterpolation<number> | number }>;
const BRAND = 'PILLOW STAYS';

// A fixed, hand-tuned starfield: three groups that twinkle out of phase.
const STARS = (() => {
  let seed = 7;
  const next = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  return Array.from({ length: 30 }, (_, index) => { const x = next() * 100, y = next() * 62; return { x, y: x > 24 && x < 76 && y > 14 ? y * 0.22 : y, r: 0.5 + next() * 1.3, group: index % 3 }; });
})();
const SPARKLES = [{ x: 16, y: 13, s: 7, group: 0 }, { x: 84, y: 9, s: 9, group: 1 }, { x: 74, y: 31, s: 5, group: 2 }, { x: 9, y: 38, s: 5, group: 1 }];
const sparklePath = (cx: number, cy: number, s: number) =>
  `M${cx} ${cy - s} Q${cx + s * 0.16} ${cy - s * 0.16} ${cx + s} ${cy} Q${cx + s * 0.16} ${cy + s * 0.16} ${cx} ${cy + s} Q${cx - s * 0.16} ${cy + s * 0.16} ${cx - s} ${cy} Q${cx - s * 0.16} ${cy - s * 0.16} ${cx} ${cy - s}Z`;

function useValues<T extends string>(names: readonly T[], start = 0) {
  const [values] = useState(() => Object.fromEntries(names.map(name => [name, new Animated.Value(start)])) as Record<T, Animated.Value>);
  return values;
}

/** The night sky behind the brand: a plum gradient, slow aurora light and twinkling stars. */
function Sky({ drift, twinkle, reveal, width, height }: { drift: Animated.Value; twinkle: Animated.Value; reveal: Animated.Value; width: number; height: number }) {
  const blob = (size: number, tint: string, opacity: number, key: string) => <Svg width={size} height={size} viewBox="0 0 100 100">
    <Defs><RadialGradient id={key} cx="50%" cy="50%" r="50%">
      <Stop offset="0" stopColor={tint} stopOpacity={opacity}/><Stop offset="0.55" stopColor={tint} stopOpacity={opacity * 0.35}/><Stop offset="1" stopColor={tint} stopOpacity="0"/>
    </RadialGradient></Defs>
    <Circle cx="50" cy="50" r="50" fill={`url(#${key})`}/>
  </Svg>;
  const move = (x: number, y: number, scale: number) => ({ transform: [
    { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, x] }) },
    { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [0, y] }) },
    { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [1, scale] }) }] });
  const phases = [[0.25, 1, 0.25], [1, 0.2, 1], [0.6, 0.15, 0.95, 0.6]];
  const twinkleOpacity = (group: number) => twinkle.interpolate({ inputRange: group === 2 ? [0, 0.3, 0.7, 1] : [0, 0.5, 1], outputRange: phases[group] });
  const big = Math.max(width, height);
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden style={StyleSheet.absoluteFill}>
    <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <Defs><LinearGradient id="welcome-sky" x1="0" y1="0" x2="0.35" y2="1">
        <Stop offset="0" stopColor={palette.plum900}/><Stop offset="0.5" stopColor={palette.plum800}/><Stop offset="1" stopColor="#3D2150"/>
      </LinearGradient></Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#welcome-sky)"/>
    </Svg>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: reveal }]}>
      <Animated.View style={[styles.blob, { top: -big * 0.18, left: -big * 0.3 }, move(big * 0.08, big * 0.05, 1.12)]}>{blob(big * 0.85, palette.plum500, 0.85, 'aurora-a')}</Animated.View>
      <Animated.View style={[styles.blob, { top: height * 0.2, right: -big * 0.35 }, move(-big * 0.07, big * 0.04, 0.9)]}>{blob(big * 0.8, palette.lavender300, 0.32, 'aurora-b')}</Animated.View>
      <Animated.View style={[styles.blob, { top: height * 0.38, left: -big * 0.15 }, move(big * 0.05, -big * 0.06, 1.15)]}>{blob(big * 0.6, palette.apricot200, 0.2, 'aurora-c')}</Animated.View>
      {[0, 1, 2].map(group => <Animated.View key={group} style={[StyleSheet.absoluteFill, { opacity: twinkleOpacity(group) }]}>
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {STARS.filter(star => star.group === group).map((star, index) => <Circle key={index} cx={star.x / 100 * width} cy={star.y / 100 * height} r={star.r} fill={palette.cream}/>)}
          {SPARKLES.filter(star => star.group === group).map((star, index) => <Path key={'s' + index} d={sparklePath(star.x / 100 * width, star.y / 100 * height, star.s)} fill={palette.apricot200}/>)}
        </Svg>
      </Animated.View>)}
    </Animated.View>
  </View>;
}

/** The approved pillow symbol on a cream disc, ringed by a line that draws itself and a slow orbit. */
function Emblem({ size, spread = 1.9, emblem, ring, float, glow, orbit }: {
  size: number; spread?: number; emblem: Animated.Value; ring: Animated.Value; float: Animated.Value; glow: Animated.Value; orbit: Animated.Value;
}) {
  const box = size * spread, center = box / 2, ringR = size * 0.6, orbitR = size * 0.78, circumference = 2 * Math.PI * ringR;
  return <View style={{ width: box, height: box, alignItems: 'center', justifyContent: 'center' }} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }),
      transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.08] }) }] }]}>
      <Svg width={box} height={box}><Defs><RadialGradient id="emblem-glow" cx="50%" cy="50%" r="50%">
        <Stop offset="0" stopColor={palette.apricot200} stopOpacity="0.5"/><Stop offset="0.45" stopColor={palette.lavender300} stopOpacity="0.22"/><Stop offset="1" stopColor={palette.lavender300} stopOpacity="0"/>
      </RadialGradient></Defs><Circle cx={center} cy={center} r={center} fill="url(#emblem-glow)"/></Svg>
    </Animated.View>
    <Animated.View style={[StyleSheet.absoluteFill, { opacity: emblem, transform: [{ rotate: orbit.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}>
      <Svg width={box} height={box}>
        <Circle cx={center} cy={center} r={orbitR} stroke={palette.lavender300} strokeOpacity={0.4} strokeWidth={1} strokeDasharray="1.5 7" fill="none" strokeLinecap="round"/>
        <Circle cx={center} cy={center - orbitR} r={3.5} fill={palette.apricot200}/>
        <Path d={sparklePath(center + orbitR * 0.71, center + orbitR * 0.71, 5)} fill={palette.lavender300}/>
      </Svg>
    </Animated.View>
    <View style={StyleSheet.absoluteFill}>
      <Svg width={box} height={box}>
        <Defs><LinearGradient id="emblem-ring" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={palette.apricot200}/><Stop offset="0.5" stopColor={palette.cream}/><Stop offset="1" stopColor={palette.lavender300}/>
        </LinearGradient></Defs>
        <AnimatedCircle cx={center} cy={center} r={ringR} stroke="url(#emblem-ring)" strokeWidth={2.5} fill="none" strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`} transform={`rotate(-90 ${center} ${center})`}
          strokeDashoffset={ring.interpolate({ inputRange: [0, 1], outputRange: [circumference, 0] })}/>
      </Svg>
    </View>
    <Animated.View style={{ opacity: emblem, transform: [
      { scale: emblem.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] }) },
      { translateY: float.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }}>
      <View style={[styles.disc, { width: size, height: size, borderRadius: size / 2 }]}>
        <Image accessible={false} source={require('../../assets/pillow-symbol.png')} resizeMode="contain" style={{ width: size * 0.66, height: size * 0.5 }}/>
      </View>
    </Animated.View>
  </View>;
}

const rise = (value: Animated.Value, distance = 14) => ({ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }] });

/* Destination photography (CC0 / public domain, see assets/DESTINATIONS.md). Places, not hotels. */
const PHOTOS = [
  { source: require('../../assets/welcome-dubai-marina.jpg'), place: 'Dubai Marina', placeAr: 'مرسى دبي' },
  { source: require('../../assets/istanbul-destination.jpg'), place: 'Sultanahmet, Istanbul', placeAr: 'السلطان أحمد، إسطنبول' },
  { source: require('../../assets/paris-destination.jpg'), place: 'Paris', placeAr: 'باريس' },
] as const;
const CYCLE_MS = 7000 * PHOTOS.length;
const clamp3 = (values: number[]) => values.map(v => Math.min(PHOTOS.length, Math.max(0, v)));
// Opacity and slow zoom of each photo across one cycle (value 0..3): hold, then a soft cross-fade.
const photoOpacity = (index: number) => index === 0
  ? { inputRange: [0, 0.82, 1, 2.82, 3], outputRange: [1, 1, 0, 0, 1] }
  : { inputRange: clamp3([0, index - 0.18, index, index + 0.82, index + 1, 3]), outputRange: [0, 0, 1, 1, 0, 0] };
const photoScale = (index: number) => index === 0
  ? { inputRange: [0, 1, 2.82, 3], outputRange: [1, 1.09, 1.09, 1] }
  : { inputRange: clamp3([0, index - 0.18, index + 1, 3]), outputRange: [1, 1, 1.09, 1.09] };

/** Real places, slowly breathing: a cinematic cross-fade under a plum veil that keeps our colours in charge. */
function PhotoStage({ slide, reveal }: { slide: Animated.Value; reveal: Animated.Value }) {
  return <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden style={[StyleSheet.absoluteFill, { opacity: reveal }]}>
    {PHOTOS.map((photo, index) => <Animated.Image key={photo.place} source={photo.source} resizeMode="cover"
      style={[StyleSheet.absoluteFill, { width: '100%', height: '100%', opacity: slide.interpolate(photoOpacity(index)), transform: [{ scale: slide.interpolate(photoScale(index)) }] }]}/>)}
    <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
      <Defs>
        <LinearGradient id="welcome-veil" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={palette.plum900} stopOpacity="0.42"/><Stop offset="0.4" stopColor={palette.plum800} stopOpacity="0.22"/>
          <Stop offset="0.74" stopColor={palette.plum900} stopOpacity="0.7"/><Stop offset="1" stopColor={palette.plum900} stopOpacity="0.97"/>
        </LinearGradient>
        {/* A soft dark ellipse behind the name and promise keeps them legible over bright skies. */}
        <RadialGradient id="welcome-halo" cx="0.5" cy="0.36" r="0.5" gradientTransform="translate(0.5 0.36) scale(1.5 0.46) translate(-0.5 -0.36)">
          <Stop offset="0" stopColor={palette.plum900} stopOpacity="0.46"/><Stop offset="0.6" stopColor={palette.plum900} stopOpacity="0.22"/><Stop offset="1" stopColor={palette.plum900} stopOpacity="0"/>
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100" height="100" fill="url(#welcome-veil)"/>
      <Rect x="0" y="0" width="100" height="100" fill="url(#welcome-halo)"/>
    </Svg>
  </Animated.View>;
}

/*
 * The front door: real places breathing behind the Pillow Stays emblem, the promise in one line, Tabby's
 * approved banner in its light theme, and the way in (apply for membership, or sign in). Everything
 * arrives once in sequence, then the decoration settles so the photos and the choice stay in focus;
 * with "reduce motion" on, it is all simply there.
 */
export default function WelcomeScreen() {
  const { language, setLanguage } = useLanguage();
  const ar = language === 'ar';
  const router = useRouter();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = height < 900;
  const tiny = height < 700;
  const wide = width >= 720;
  const intro = useValues(['reveal', 'emblem', 'word', 'letters', 'tagline', 'caption', 'promo', 'sheet', 'benefits'] as const);
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [ring] = useState(() => new Animated.Value(0));
  const loops = useValues(['float', 'glow', 'orbit', 'drift', 'twinkle', 'slide'] as const);
  const [photo, setPhoto] = useState(0);

  useEffect(() => {
    const all = Object.values(intro) as Animated.Value[];
    // The caption follows whichever photo is in front, switching at the middle of each cross-fade.
    const listener = loops.slide.addListener(({ value }) => setPhoto(current => { const front = Math.floor(value + 0.09) % PHOTOS.length; return front === current ? current : front; }));
    if (reduced) { all.forEach(value => value.setValue(1)); ring.setValue(1); return () => loops.slide.removeListener(listener); }
    const at = (delay: number, animation: Animated.CompositeAnimation) => Animated.sequence([Animated.delay(delay), animation]);
    const ease = (value: Animated.Value, duration: number) => Animated.timing(value, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: native });
    const spring = (value: Animated.Value, friction = 6) => Animated.spring(value, { toValue: 1, friction, tension: 60, useNativeDriver: native });
    const show = Animated.parallel([
      ease(intro.reveal, 1200),
      at(180, Animated.timing(ring, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.cubic), useNativeDriver: false })),
      at(260, spring(intro.emblem, 5)),
      at(620, ease(intro.word, 650)),
      at(800, Animated.timing(intro.letters, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: native })),
      at(1150, ease(intro.tagline, 650)),
      at(1350, ease(intro.caption, 600)),
      at(1300, spring(intro.sheet, 9)),
      at(1600, spring(intro.promo, 7)),
      at(1750, ease(intro.benefits, 700)),
    ]);
    const breathe = (value: Animated.Value, duration: number) => Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: native })]));
    const photos = Animated.loop(Animated.timing(loops.slide, { toValue: PHOTOS.length, duration: CYCLE_MS, easing: Easing.linear, useNativeDriver: native }));
    // Decoration that settles after the arrival: the emblem's float, glow and orbit.
    const settling = [breathe(loops.float, 1900), breathe(loops.glow, 2400),
      Animated.loop(Animated.timing(loops.orbit, { toValue: 1, duration: 22000, easing: Easing.linear, useNativeDriver: native }))];
    const all3 = [show, photos, ...settling];
    all3.forEach(animation => animation.start());
    const settle = setTimeout(() => settling.forEach(animation => animation.stop()), 9000);
    return () => { clearTimeout(settle); loops.slide.removeListener(listener); all3.forEach(animation => animation.stop()); };
  }, [reduced, intro, loops, ring]);

  const account = (mode: 'register' | 'login') => {
    haptic('select');
    // A shared link opened before signing in is where sign-in returns.
    router.replace({ pathname: '/account', params: { mode, returnTo: typeof next === 'string' && next.startsWith('/') ? next : '/' } });
  };

  const emblemSize = tiny ? 52 : compact ? 68 : 90;
  const letters = Array.from(BRAND);
  const step = 0.65 / letters.length;
  const tagline = ar ? 'مخدتك جاهزة في مدن العالم، بسعر الأعضاء' : 'Your pillow, ready in cities worldwide, at member prices';
  // What membership gives, in words the app can stand behind.
  const benefits: { icon: IconName; label: string }[] = [
    { icon: 'sparkles', label: ar ? 'أسعار للأعضاء فقط' : 'Member-only prices' },
    { icon: 'chat', label: ar ? 'عناية خاصة بكل حجز' : 'Care for every booking' },
    { icon: 'shield', label: ar ? 'دفع آمن بالكامل' : 'Fully secure payment' },
  ];
  const place = ar ? PHOTOS[photo].placeAr : PHOTOS[photo].place;

  return <View style={styles.screen} testID="welcome-screen">
    <StatusBar style="light"/>
    <Sky drift={loops.drift} twinkle={loops.twinkle} reveal={intro.reveal} width={width} height={height}/>
    <PhotoStage slide={loops.slide} reveal={intro.reveal}/>
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <Row style={[styles.top, { paddingHorizontal: space.lg }]}>
        <Pressable testID="welcome-language" accessibilityRole="button" accessibilityLabel={ar ? 'English' : 'العربية'}
          onPress={() => setLanguage(ar ? 'en' : 'ar')} hitSlop={8}
          style={state => [styles.language, (state.pressed || hovered(state)) && { backgroundColor: 'rgba(255,255,255,0.22)' }]}>
          <Icon name="globe" size={16} color={palette.cream}/>
          <Text style={[styles.languageText, { fontFamily: ar ? latinFonts.medium : fonts.medium }]}>{ar ? 'English' : 'العربية'}</Text>
        </Pressable>
      </Row>

      <View style={[styles.hero, { gap: tiny ? 4 : compact ? space.xs : space.sm }]} accessible accessibilityRole="header"
        accessibilityLabel={`${ar ? 'مخدة' : 'Pillow Stays'}. ${tagline}`}>
        <Emblem size={emblemSize} spread={compact ? 1.6 : 1.85} emblem={intro.emblem} ring={ring} float={loops.float} glow={loops.glow} orbit={loops.orbit}/>
        <View style={{ alignItems: 'center', marginTop: -emblemSize * (compact ? 0.16 : 0.24) }}>
          <Animated.Text allowFontScaling={false} style={[styles.word, { fontSize: tiny ? 30 : compact ? 38 : 46, lineHeight: tiny ? 40 : compact ? 50 : 60 }, rise(intro.word)]}>مخدة</Animated.Text>
          <View style={styles.letters}>
            {letters.map((letter, index) => {
              const from = index * step;
              const value = intro.letters.interpolate({ inputRange: [from, from + 0.35, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });
              return <Animated.Text key={index} allowFontScaling={false} style={[styles.letter, { opacity: value,
                transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{letter === ' ' ? '  ' : letter}</Animated.Text>;
            })}
          </View>
        </View>
        <Animated.View style={[{ paddingHorizontal: space.xl, maxWidth: wide ? 560 : 400 }, rise(intro.tagline)]}>
          <Text style={[styles.tagline, { fontFamily: ar ? fonts.medium : latinFonts.medium, fontSize: tiny ? 15 : compact ? 16.5 : 19, lineHeight: tiny ? 24 : compact ? 27 : 31 }]}>{tagline}</Text>
        </Animated.View>
      </View>

      {/* Where the photo was taken: a quiet caption that follows the slideshow. */}
      <Animated.View pointerEvents="none" style={[styles.caption, { alignSelf: ar ? 'flex-end' : 'flex-start', opacity: intro.caption }]}>
        <Row style={{ gap: 5 }}>
          <Icon name="pin" size={12} color={palette.cream}/>
          <Text testID="welcome-photo-place" style={[styles.captionText, { fontFamily: ar ? fonts.medium : latinFonts.medium }]}>{place}</Text>
        </Row>
      </Animated.View>

      {/* Tabby's approved banner, in Tabby's light theme. */}
      <Animated.View style={[styles.promo, wide && styles.promoWide, { opacity: intro.promo,
        transform: [{ translateY: intro.promo.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }, { scale: intro.promo.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}>
        <TabbyBanner compact={compact}/>
      </Animated.View>

      <Animated.View style={[styles.sheet, wide && styles.sheetWide, tiny && { gap: space.sm }, { paddingBottom: Math.max(insets.bottom, space.lg) + (wide ? 0 : space.xs) },
        { opacity: intro.sheet, transform: [{ translateY: intro.sheet.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }] }]}>
        {!wide && <View style={styles.handle}/>}
        <View style={{ gap: 2 }}>
          <Txt kind="heading" align="center" accessibilityRole="header">{ar ? 'عضوية مخدة مجانية' : 'Pillow Stays membership is free'}</Txt>
          {!tiny && <Txt kind="small" align="center">{ar ? 'قدّم طلبك، ونراجعه، وبعد الموافقة تنفتح لك أسعار الأعضاء.' : 'Apply, we review it, and once approved member prices open up.'}</Txt>}
        </View>
        {!tiny && <Animated.View testID="welcome-benefits" style={[styles.benefits, { flexDirection: ar ? 'row-reverse' : 'row' }, rise(intro.benefits, 10)]}>
          {benefits.map(item => <View key={item.label} style={styles.benefit}>
            <View style={styles.benefitIcon}><Icon name={item.icon} size={17} color={color.interactiveStrong}/></View>
            <Text style={[styles.benefitText, { fontFamily: ar ? fonts.medium : latinFonts.medium }]} numberOfLines={2}>{item.label}</Text>
          </View>)}
        </Animated.View>}
        <View style={{ gap: space.sm }}>
          <Button testID="welcome-register" fill icon="sparkles" title={ar ? 'اطلب عضويتك المجانية' : 'Apply for free membership'} onPress={() => account('register')}/>
          <Button testID="welcome-login" fill variant="secondary" title={ar ? 'لدي حساب · تسجيل الدخول' : 'I have an account · Sign in'} onPress={() => account('login')}/>
        </View>
      </Animated.View>
    </SafeAreaView>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.plum900, overflow: 'hidden' },
  blob: { position: 'absolute' },
  top: { justifyContent: 'flex-start', paddingTop: space.sm, minHeight: 44 },
  language: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill,
    backgroundColor: 'rgba(32,22,38,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  languageText: { color: palette.cream, fontSize: 13, lineHeight: 18 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space.sm },
  disc: { backgroundColor: palette.cream, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.4, shadowRadius: 28, elevation: 14 },
  word: { color: palette.cream, fontFamily: fonts.bold, writingDirection: 'rtl', textAlign: 'center', textShadowColor: 'rgba(20,10,28,0.55)', textShadowRadius: 18 },
  letters: { flexDirection: 'row', direction: 'ltr', marginTop: -4 },
  letter: { color: '#F1EAFF', fontFamily: latinFonts.bold, fontSize: 13, lineHeight: 18, marginHorizontal: 2.2, textShadowColor: 'rgba(20,10,28,0.55)', textShadowRadius: 8 },
  tagline: { color: palette.white, textAlign: 'center', textShadowColor: 'rgba(20,10,28,0.6)', textShadowRadius: 12 },
  caption: { marginHorizontal: space.lg, marginBottom: space.xs, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill,
    backgroundColor: 'rgba(32,22,38,0.5)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.2)' },
  captionText: { color: palette.cream, fontSize: 11.5, lineHeight: 16 },
  promo: { paddingHorizontal: space.lg, marginBottom: space.sm, width: '100%', maxWidth: 480, alignSelf: 'center' },
  promoWide: { maxWidth: 440 },
  sheet: { gap: space.md, backgroundColor: color.bgCanvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space.xl, paddingTop: space.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 16 },
  sheetWide: { alignSelf: 'center', width: 440, borderRadius: 28, marginBottom: space.xxl, paddingTop: space.xl },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: color.border },
  benefits: { justifyContent: 'space-between', gap: space.sm },
  benefit: { flex: 1, alignItems: 'center', gap: 6 },
  benefitIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: color.bgSelected },
  benefitText: { color: color.textBrand, fontSize: 12.5, lineHeight: 17, textAlign: 'center' },
});
