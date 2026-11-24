import React, { useEffect, useState } from 'react';
import { Animated, BackHandler, Easing, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { PressableStateCallbackType } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useLanguage } from '../i18n';
import { color, fonts, latinFonts, palette, radius, space } from '../theme';
import { Button, Icon, Row, TextLink, Txt } from '../components/Primitives';
import type { IconName } from '../components/Primitives';
import { useReducedMotion } from '../components/motion';
import { haptic } from '../components/haptics';
import { WELCOME_KEY } from '../components/welcomeModel';

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

/*
 * The front door: a living night sky over the Mkhadda emblem, the promise in one line, and the two
 * ways in (create an account, sign in). Everything moves once on arrival, then breathes quietly;
 * with "reduce motion" on, it is all simply there.
 */
export default function WelcomeScreen() {
  const { language, setLanguage, rtl } = useLanguage();
  const ar = language === 'ar';
  const router = useRouter();
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const compact = height < 740;
  const tiny = height < 700;
  const wide = width >= 720;
  const intro = useValues(['reveal', 'emblem', 'word', 'letters', 'tagline', 'chips', 'pill', 'sheet'] as const);
  const [ring] = useState(() => new Animated.Value(0));
  const loops = useValues(['drift', 'twinkle', 'float', 'glow', 'orbit', 'shine'] as const);

  useEffect(() => {
    const all = Object.values(intro) as Animated.Value[];
    if (reduced) { all.forEach(value => value.setValue(1)); ring.setValue(1); return; }
    const at = (delay: number, animation: Animated.CompositeAnimation) => Animated.sequence([Animated.delay(delay), animation]);
    const ease = (value: Animated.Value, duration: number) => Animated.timing(value, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: native });
    const spring = (value: Animated.Value, friction = 6) => Animated.spring(value, { toValue: 1, friction, tension: 60, useNativeDriver: native });
    const show = Animated.parallel([
      ease(intro.reveal, 1100),
      at(180, Animated.timing(ring, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.cubic), useNativeDriver: false })),
      at(260, spring(intro.emblem, 5)),
      at(640, ease(intro.word, 650)),
      at(820, Animated.timing(intro.letters, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: native })),
      at(1180, ease(intro.tagline, 650)),
      at(1380, ease(intro.chips, 800)),
      at(1560, spring(intro.pill, 5)),
      at(1450, spring(intro.sheet, 9)),
    ]);
    const breathe = (value: Animated.Value, duration: number) => Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: native }),
      Animated.timing(value, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: native })]));
    const running = [show, breathe(loops.drift, 9000), breathe(loops.float, 1900), breathe(loops.glow, 2400),
      Animated.loop(Animated.timing(loops.twinkle, { toValue: 1, duration: 3200, easing: Easing.linear, useNativeDriver: native })),
      Animated.loop(Animated.timing(loops.orbit, { toValue: 1, duration: 22000, easing: Easing.linear, useNativeDriver: native })),
      Animated.loop(Animated.sequence([Animated.delay(2200), Animated.timing(loops.shine, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.quad), useNativeDriver: native }),
        Animated.timing(loops.shine, { toValue: 0, duration: 0, useNativeDriver: native })]))];
    running.forEach(animation => animation.start());
    return () => running.forEach(animation => animation.stop());
  }, [reduced, intro, loops, ring]);

  // "Explore first" (or the system back gesture) quiets the welcome front for a week.
  const explore = () => {
    void AsyncStorage.setItem(WELCOME_KEY, String(Date.now())).catch(() => {});
    if (router.canGoBack()) router.back(); else router.replace('/');
  };
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { void AsyncStorage.setItem(WELCOME_KEY, String(Date.now())).catch(() => {}); return false; });
    return () => subscription.remove();
  }, []);
  const account = (mode: 'register' | 'login') => {
    haptic('select');
    router.replace({ pathname: '/account', params: { mode, returnTo: '/' } });
  };

  const emblemSize = tiny ? 84 : compact ? 104 : 128;
  const categories: { icon: IconName; label: string; soon: boolean }[] = [
    { icon: 'hotel', label: ar ? 'فنادق' : 'Hotels', soon: false },
    { icon: 'calendar', label: ar ? 'فعاليات' : 'Events', soon: true },
    { icon: 'voucher', label: ar ? 'تذاكر' : 'Tickets', soon: true },
  ];
  const letters = Array.from(BRAND);
  const step = 0.65 / letters.length;
  const pillWidth = 300;

  return <View style={styles.screen} testID="welcome-screen">
    <StatusBar style="light"/>
    <Sky drift={loops.drift} twinkle={loops.twinkle} reveal={intro.reveal} width={width} height={height}/>
    <SafeAreaView edges={['top']} style={{ flex: 1 }}>
      <Row style={[styles.top, { paddingHorizontal: space.lg }]}>
        <Pressable testID="welcome-language" accessibilityRole="button" accessibilityLabel={ar ? 'English' : 'العربية'}
          onPress={() => setLanguage(ar ? 'en' : 'ar')} hitSlop={8}
          style={state => [styles.language, (state.pressed || hovered(state)) && { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
          <Icon name="globe" size={16} color={palette.cream}/>
          <Text style={[styles.languageText, { fontFamily: ar ? latinFonts.medium : fonts.medium }]}>{ar ? 'English' : 'العربية'}</Text>
        </Pressable>
      </Row>

      <View style={[styles.hero, { gap: tiny ? 6 : compact ? space.sm : space.md }]} accessible accessibilityRole="header"
        accessibilityLabel={ar ? 'مخدة، pillow stays. أفضل عروض الفنادق والفعاليات والتذاكر في مكان واحد. سعر مدلّل لأعضائنا فقط.'
          : 'Mkhadda, pillow stays. The best hotel, event and ticket deals in one place. Pampered prices, for members only.'}>
        <Emblem size={emblemSize} spread={tiny ? 1.6 : 1.9} emblem={intro.emblem} ring={ring} float={loops.float} glow={loops.glow} orbit={loops.orbit}/>
        <View style={{ alignItems: 'center', marginTop: -emblemSize * (tiny ? 0.18 : 0.28) }}>
          <Animated.Text allowFontScaling={false} style={[styles.word, { fontSize: tiny ? 32 : compact ? 38 : 46, lineHeight: tiny ? 42 : compact ? 50 : 60 }, rise(intro.word)]}>مخدة</Animated.Text>
          <View style={styles.letters}>
            {letters.map((letter, index) => {
              const from = index * step;
              const value = intro.letters.interpolate({ inputRange: [from, from + 0.35, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });
              return <Animated.Text key={index} allowFontScaling={false} style={[styles.letter, { opacity: value,
                transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{letter === ' ' ? '  ' : letter}</Animated.Text>;
            })}
          </View>
        </View>
        <Animated.View style={[{ paddingHorizontal: space.xl, maxWidth: wide ? 560 : 420 }, rise(intro.tagline)]}>
          <Text style={[styles.tagline, { fontFamily: ar ? fonts.medium : latinFonts.medium, fontSize: tiny ? 15 : compact ? 17 : 19, lineHeight: tiny ? 23 : compact ? 27 : 30 }]}>
            {ar ? 'أفضل عروض الفنادق والفعاليات والتذاكر في مكان واحد' : 'The best deals on hotels, events and tickets, all in one place'}</Text>
        </Animated.View>
        <Row style={{ gap: space.xs + 2, justifyContent: 'center', flexWrap: 'wrap', paddingHorizontal: space.md }}>
          {categories.map((category, index) => {
            const value = intro.chips.interpolate({ inputRange: [index * 0.2, index * 0.2 + 0.6, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' });
            return <Animated.View key={category.icon} style={[styles.category, category.soon ? null : styles.categoryActive, { opacity: value,
              transform: [{ scale: value.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }]}>
              <Row style={{ gap: 6 }}>
                <Icon name={category.icon} size={16} color={category.soon ? palette.lavender300 : palette.plum800}/>
                <Text style={[styles.categoryText, { color: category.soon ? palette.lavender100 : palette.plum800, fontFamily: ar ? fonts.medium : latinFonts.medium }]}>{category.label}</Text>
                {category.soon && <View style={styles.soon}><Text style={[styles.soonText, { fontFamily: ar ? fonts.medium : latinFonts.medium }]}>{ar ? 'قريباً' : 'Soon'}</Text></View>}
              </Row>
            </Animated.View>;
          })}
        </Row>
        <Animated.View style={{ opacity: intro.pill, transform: [{ scale: intro.pill.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] }) }] }}>
          <View style={styles.pill} testID="welcome-member-pill">
            <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 100 10" style={StyleSheet.absoluteFill}>
              <Defs><LinearGradient id="welcome-pill" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={palette.apricot200}/><Stop offset="0.5" stopColor={palette.apricot100}/><Stop offset="1" stopColor={palette.gold200}/>
              </LinearGradient></Defs>
              <Rect x="0" y="0" width="100" height="10" fill="url(#welcome-pill)"/>
            </Svg>
            {!reduced && <Animated.View pointerEvents="none" style={[styles.shine, { transform: [{ translateX: loops.shine.interpolate({ inputRange: [0, 1], outputRange: rtl ? [pillWidth, -90] : [-90, pillWidth] }) }, { skewX: '-18deg' }] }]}>
              <Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 10 10"><Defs><LinearGradient id="welcome-shine" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0"/><Stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0.85"/><Stop offset="1" stopColor="#FFFFFF" stopOpacity="0"/>
              </LinearGradient></Defs><Rect x="0" y="0" width="10" height="10" fill="url(#welcome-shine)"/></Svg>
            </Animated.View>}
            <Row style={{ gap: 6 }}>
              <Icon name="sparkles" size={16} color={palette.apricot800}/>
              <Text style={[styles.pillText, { fontFamily: ar ? fonts.bold : latinFonts.bold }]}>{ar ? 'سعر مدلّل لأعضائنا فقط' : 'Pampered prices, for members only'}</Text>
            </Row>
          </View>
        </Animated.View>
      </View>

      <Animated.View style={[styles.sheet, wide && styles.sheetWide, tiny && { gap: space.md }, { paddingBottom: Math.max(insets.bottom, space.lg) + (wide ? 0 : space.xs) },
        { opacity: intro.sheet, transform: [{ translateY: intro.sheet.interpolate({ inputRange: [0, 1], outputRange: [80, 0] }) }] }]}>
        {!wide && <View style={styles.handle}/>}
        <View style={{ gap: 2 }}>
          <Txt kind="heading" align="center" accessibilityRole="header">{ar ? 'أهلاً بك في مخدة' : 'Welcome to Mkhadda'}</Txt>
          {!tiny && <Txt kind="small" align="center">{ar ? 'حسابك بوابتك إلى أسعار الأعضاء وحجوزاتك في مكان واحد.' : 'Your account opens member prices and keeps every booking in one place.'}</Txt>}
        </View>
        <View style={{ gap: space.sm }}>
          <Button testID="welcome-register" fill icon="sparkles" title={ar ? 'إنشاء حساب جديد' : 'Create an account'} onPress={() => account('register')}/>
          <Button testID="welcome-login" fill variant="secondary" title={ar ? 'لدي حساب · تسجيل الدخول' : 'I have an account · Sign in'} onPress={() => account('login')}/>
        </View>
        <View style={{ alignItems: 'center' }}>
          <TextLink testID="welcome-explore" title={ar ? 'استكشف الفنادق أولاً' : 'Explore hotels first'} icon="forward" onPress={explore}/>
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
    backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  languageText: { color: palette.cream, fontSize: 13, lineHeight: 18 },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: space.lg },
  disc: { backgroundColor: palette.cream, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.35, shadowRadius: 28, elevation: 14 },
  word: { color: palette.cream, fontFamily: fonts.bold, writingDirection: 'rtl', textAlign: 'center' },
  letters: { flexDirection: 'row', direction: 'ltr', marginTop: -4 },
  letter: { color: palette.lavender300, fontFamily: latinFonts.bold, fontSize: 13, lineHeight: 18, marginHorizontal: 2.2 },
  tagline: { color: palette.white, textAlign: 'center' },
  category: { minHeight: 34, paddingHorizontal: 10, borderRadius: radius.pill, justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  categoryActive: { backgroundColor: palette.cream, borderColor: palette.cream },
  categoryText: { fontSize: 13, lineHeight: 18 },
  soon: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.pill, backgroundColor: 'rgba(249,221,201,0.18)' },
  soonText: { color: palette.apricot200, fontSize: 10, lineHeight: 14 },
  pill: { minHeight: 40, paddingHorizontal: space.lg, borderRadius: radius.pill, overflow: 'hidden', justifyContent: 'center', maxWidth: 360 },
  shine: { position: 'absolute', top: -10, bottom: -10, left: 0, width: 70 },
  pillText: { color: palette.plum800, fontSize: 14, lineHeight: 20 },
  sheet: { gap: space.lg, backgroundColor: color.bgCanvas, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: space.xl, paddingTop: space.md,
    shadowColor: '#000', shadowOffset: { width: 0, height: -8 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 16 },
  sheetWide: { alignSelf: 'center', width: 440, borderRadius: 28, marginBottom: space.xxl, paddingTop: space.xl },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.neutral200 },
});
