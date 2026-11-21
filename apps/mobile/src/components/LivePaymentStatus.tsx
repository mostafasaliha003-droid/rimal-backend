import React, { useEffect, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import type { CheckoutStatus } from '../api/checkout';
import { useLanguage } from '../i18n';
import { color, elevation, fonts, radius, space } from '../theme';
import { Icon, Row, Txt, type IconName } from './Primitives';
import { useReducedMotion } from './motion';
import { livePaymentModel, type LiveStage } from './livePaymentModel';
import { haptic } from './haptics';

const native = Platform.OS !== 'web';

/** Two soft rings that keep expanding from the centre while the booking is being worked on. */
function Pulse({ tint, reduced }: { tint: string; reduced: boolean }) {
  const [waves] = useState(() => [new Animated.Value(0), new Animated.Value(0)]);
  useEffect(() => {
    if (reduced) return;
    const loops = waves.map(wave => Animated.loop(Animated.timing(wave, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: native })));
    loops[0].start();
    const second = setTimeout(() => loops[1].start(), 900);
    return () => { clearTimeout(second); loops.forEach(loop => loop.stop()); waves.forEach(wave => wave.setValue(0)); };
  }, [waves, reduced]);
  if (reduced) return null;
  return <>{waves.map((wave, index) => <Animated.View key={index} accessible={false} style={[styles.ring, { borderColor: tint,
    opacity: wave.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0.12, 0] }),
    transform: [{ scale: wave.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }] }]}/>)}</>;
}

/** The centre mark: a turning arc while working, a check that springs in, or an alert. */
function Mark({ tone, icon, reduced }: { tone: 'working' | 'success' | 'attention'; icon: IconName; reduced: boolean }) {
  const [spin] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(reduced || tone !== 'success' ? 1 : 0.4));
  useEffect(() => {
    if (tone !== 'working' || reduced) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver: native }));
    loop.start();
    return () => { loop.stop(); spin.setValue(0); };
  }, [spin, tone, reduced]);
  useEffect(() => {
    if (tone === 'success') haptic('confirm');
    if (tone !== 'success' || reduced) { pop.setValue(1); return; }
    pop.setValue(0.4);
    Animated.spring(pop, { toValue: 1, friction: 5, tension: 120, useNativeDriver: native }).start();
  }, [pop, tone, reduced]);
  const tint = tone === 'success' ? color.success : tone === 'attention' ? color.warning : color.interactive;
  const fill = tone === 'success' ? color.success : tone === 'attention' ? color.warningBg : color.bgSelected;
  return <View style={styles.markBox} accessible={false}>
    {tone === 'working' && <Pulse tint={tint} reduced={reduced}/>}
    <Animated.View style={[styles.mark, { backgroundColor: fill, transform: [{ scale: pop }] }]}>
      {tone === 'working' && !reduced && <Animated.View style={[styles.arc, { borderTopColor: tint,
        transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }] }]}/>}
      <Icon name={icon} size={30} color={tone === 'success' ? color.textOnDark : tint}/>
    </Animated.View>
  </View>;
}

/** A dot that breathes beside "Live", so the guest can see the page is still updating itself. */
function LiveDot({ reduced }: { reduced: boolean }) {
  const [breath] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 0.25, duration: 700, useNativeDriver: native }),
      Animated.timing(breath, { toValue: 1, duration: 700, useNativeDriver: native }),
    ]));
    loop.start();
    return () => { loop.stop(); breath.setValue(1); };
  }, [breath, reduced]);
  return <Animated.View accessible={false} style={[styles.liveDot, { opacity: breath }]}/>;
}

function StageRow({ stage, last, reduced }: { stage: LiveStage; last: boolean; reduced: boolean }) {
  const tint = stage.state === 'done' ? color.success : stage.state === 'failed' ? color.danger : stage.state === 'active' ? color.interactive : color.borderControl;
  return <Row style={{ gap: space.md, alignItems: 'stretch' }}>
    <View style={{ alignItems: 'center', width: 24 }}>
      <View style={[styles.stageDot, { borderColor: tint, backgroundColor: stage.state === 'done' ? color.success : stage.state === 'failed' ? color.danger : color.bgSurface }]}>
        {stage.state === 'done' ? <Icon name="check" size={13} strokeWidth={3} color={color.textOnDark}/>
          : stage.state === 'failed' ? <Icon name="close" size={13} strokeWidth={3} color={color.textOnDark}/>
            : stage.state === 'active' ? <LiveDot reduced={reduced}/> : null}
      </View>
      {!last && <View style={[styles.stageLine, { backgroundColor: stage.state === 'done' ? color.success : color.border }]}/>}
    </View>
    <View style={{ flex: 1, minWidth: 0, paddingBottom: last ? 0 : space.md }}>
      <Txt kind="label" style={{ color: stage.state === 'waiting' ? color.textSecondary : color.textPrimary }}>{stage.title}</Txt>
      {!!stage.detail && <Txt kind="caption">{stage.detail}</Txt>}
    </View>
  </Row>;
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/*
 * The page the guest sees after paying. It updates itself (the parent keeps polling the
 * server), shows each stage as it completes, how long it has been, how long it usually
 * takes, and exactly what to do now. Payment and hotel confirmation stay separate stages:
 * a browser return is never shown as success; only the server's status is.
 */
export default function LivePaymentStatus({ status, reference, live, children, testID }: {
  status: CheckoutStatus; reference: string; live: boolean; children?: React.ReactNode; testID?: string;
}) {
  const { language } = useLanguage();
  const reduced = useReducedMotion();
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [live]);
  const elapsed = Math.max(0, Math.round((now - startedAt) / 1000));
  const model = livePaymentModel(status, language, elapsed);
  const ar = language === 'ar';
  return <View testID={testID} style={[styles.panel, elevation.raised]} accessibilityLiveRegion="polite">
    <View style={{ alignItems: 'center', gap: space.sm }}>
      <Mark key={model.tone} tone={model.tone} icon={model.icon} reduced={reduced}/>
      <Txt kind="heading" align="center" accessibilityRole="header">{model.title}</Txt>
      <Txt kind="body" tone="secondary" align="center">{model.body}</Txt>
      {live && <Row style={styles.liveChip} accessibilityLabel={ar ? `تحديث مباشر، منذ ${clock(elapsed)}` : `Updating live, ${clock(elapsed)} so far`}>
        <LiveDot reduced={reduced}/>
        <Txt kind="micro" style={{ color: color.interactiveStrong, fontFamily: fonts.bold }}>{ar ? 'مباشر' : 'LIVE'}</Txt>
        <Txt kind="micro" tone="secondary">· {ar ? 'يتحدّث تلقائياً' : 'updates automatically'} · {clock(elapsed)}</Txt>
      </Row>}
    </View>
    <View style={styles.stages}>
      {model.stages.map((stage, index) => <StageRow key={stage.key} stage={stage} last={index === model.stages.length - 1} reduced={reduced}/>)}
    </View>
    {!!model.expectation && <Row style={styles.note}>
      <Icon name={model.slow ? 'hourglass' : 'clock'} size={16} color={model.slow ? color.warning : color.textSecondary}/>
      <Txt kind="small" tone={model.slow ? 'warning' : 'primary'} style={{ flex: 1 }}>{model.expectation}</Txt>
    </Row>}
    {!!model.guidance && <Row style={styles.note}>
      <Icon name="shield" size={16} color={color.textSecondary}/>
      <Txt kind="small" tone="primary" style={{ flex: 1 }}>{model.guidance}</Txt>
    </Row>}
    <Row style={styles.reference}>
      <Txt kind="caption">{ar ? 'مرجع الطلب' : 'Request reference'}</Txt>
      <Txt kind="label" selectable style={{ writingDirection: 'ltr' }}>{reference}</Txt>
    </Row>
    {children}
  </View>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: color.bgSurface, borderRadius: radius.xl, padding: space.lg, gap: space.lg, borderWidth: 1, borderColor: color.borderCard },
  markBox: { width: 112, height: 112, alignItems: 'center', justifyContent: 'center', marginTop: space.xs },
  ring: { position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 2 },
  mark: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
  arc: { position: 'absolute', width: 76, height: 76, borderRadius: 38, borderWidth: 3, borderColor: 'transparent' },
  liveChip: { gap: space.xs, paddingHorizontal: space.sm + 2, paddingVertical: space.xxs + 1, borderRadius: radius.pill, backgroundColor: color.bgMuted },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.interactive },
  stages: { paddingHorizontal: space.xs },
  stageDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stageLine: { width: 2, flex: 1, marginVertical: 2, borderRadius: 1 },
  note: { gap: space.sm, alignItems: 'flex-start', backgroundColor: color.bgMuted, borderRadius: radius.md, padding: space.md },
  reference: { justifyContent: 'space-between', gap: space.md, flexWrap: 'wrap', paddingTop: space.sm, borderTopWidth: 1, borderTopColor: color.border },
});
