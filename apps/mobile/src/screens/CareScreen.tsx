import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import * as Crypto from 'expo-crypto';
import { api, ApiError } from '../api';
import { cleanMessage, MESSAGE_LIMIT, validSupportReference, type SupportConversation, type SupportMessage } from '../api/support';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { color, fonts, localizedFont, radius, space, typeStyle, ui } from '../theme';
import BrandHeader from '../components/BrandHeader';
import ApiState from '../components/ApiState';
import { Badge, Chip, Icon, Row, Skeleton, StatePanel, Txt } from '../components/Primitives';
import { careCopy, careIntent, carePollDelay, careRows, messageDirection, quickReplies, serverTopic } from '../components/careModel';
import { useReducedMotion } from '../components/motion';
import CareMark from '../components/CareMark';

type Outgoing = { clientId: string; body: string; state: 'sending' | 'failed' };
type Thread = { conversation: SupportConversation; messages: SupportMessage[] };
/** Each message reads in its own script's direction (an English reply stays left-to-right in the Arabic app). */
const textDirection = (body: string) => messageDirection(body) === 'rtl'
  ? { writingDirection: 'rtl' as const, textAlign: 'right' as const } : { writingDirection: 'ltr' as const, textAlign: 'left' as const };
/** The wall clock, read only from events and timers (never during render). */
const clock = () => Date.now();

/*
 * Pillow Stays care: the booking's private conversation with the team, inside the app. It is the
 * same conversation the team answers from its dashboard, so the guest never signs in twice
 * or repeats the booking details. Messages send optimistically and retry with the same id.
 */
export default function CareScreen() {
  const { reference: param, topic, draft } = useLocalSearchParams<{ reference?: string; topic?: string; draft?: string }>();
  const reference = typeof param === 'string' && validSupportReference(param) ? param : '';
  const { status, sessionRevision } = useAuth();
  return <CareContents key={`${reference}:${status}:${sessionRevision}`} reference={reference} intent={careIntent(topic)}
    draft={typeof draft === 'string' ? draft.slice(0, MESSAGE_LIMIT) : ''} signedIn={status === 'signedIn'} loading={status === 'loading'}/>;
}

function CareContents({ reference, intent, draft, signedIn, loading }: { reference: string; intent: ReturnType<typeof careIntent>; draft: string; signedIn: boolean; loading: boolean }) {
  const { language, rtl } = useLanguage();
  const copy = careCopy(language);
  const reduced = useReducedMotion();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState(draft);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [focused, setFocused] = useState(false);
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  // When the conversation last moved (0 until it opens), and how many messages have been seen.
  const lastActivity = useRef(0);
  const seen = useRef(0);
  const conversationId = thread?.conversation.id ?? '';

  // Open (or reopen) this booking's conversation, then read it.
  useEffect(() => {
    if (!signedIn || !reference) return;
    const controller = new AbortController();
    api.support.open(reference, serverTopic(intent), controller.signal)
      .then(conversation => api.support.read(conversation.id, controller.signal))
      .then(next => {
        if (controller.signal.aborted) return;
        lastActivity.current = clock(); seen.current = next.messages.length;
        setThread(next); setError(null);
      })
      .catch(failure => { if (!controller.signal.aborted) setError(failure); });
    return () => controller.abort();
  }, [signedIn, reference, intent, attempt]);

  // New replies: read again while the screen is open and the app is in front, easing off over time.
  useFocusEffect(useCallback(() => {
    if (!conversationId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    const schedule = () => { if (timer) clearTimeout(timer); timer = setTimeout(poll, carePollDelay(clock() - lastActivity.current)); };
    const poll = () => {
      if (AppState.currentState !== 'active' && AppState.currentState !== undefined) { schedule(); return; }
      api.support.read(conversationId, controller.signal).then(next => {
        if (controller.signal.aborted) return;
        if (next.messages.length > seen.current) { seen.current = next.messages.length; lastActivity.current = clock(); }
        setThread(next);
      }).catch(() => undefined).finally(() => { if (!controller.signal.aborted) schedule(); });
    };
    schedule();
    // Back in front: look for replies at once.
    const wake = AppState.addEventListener('change', state => { if (state === 'active') { if (timer) clearTimeout(timer); poll(); } });
    return () => { controller.abort(); if (timer) clearTimeout(timer); wake.remove(); };
  }, [conversationId]));

  const send = async (body: string, clientId: string = Crypto.randomUUID()) => {
    const clean = cleanMessage(body);
    if (!clean || !conversationId) return;
    lastActivity.current = clock();
    setOutgoing(rows => [...rows.filter(row => row.clientId !== clientId), { clientId, body: clean, state: 'sending' }]);
    if (body === text) setText('');
    try {
      const message = await api.support.send(conversationId, clean, clientId);
      setThread(current => current && !current.messages.some(row => row.id === message.id)
        ? { conversation: { ...current.conversation, status: 'open' }, messages: [...current.messages, message] } : current);
      seen.current += 1;
      setOutgoing(rows => rows.filter(row => row.clientId !== clientId));
    } catch {
      setOutgoing(rows => rows.map(row => row.clientId === clientId ? { ...row, state: 'failed' } : row));
    }
  };

  const rows = useMemo(() => careRows(thread?.messages ?? [], language), [thread?.messages, language]);
  const tooLong = text.length > MESSAGE_LIMIT;
  const canSend = Boolean(cleanMessage(text)) && Boolean(conversationId);
  const empty = thread && thread.messages.length === 0 && outgoing.length === 0;
  const talking = Boolean(thread && !empty);
  // Own messages sit at the end of the reading direction; the team's at the start.
  const endSide = rtl ? 'flex-start' : 'flex-end', startSide = rtl ? 'flex-end' : 'flex-start';
  const input = typeStyle('body', language);

  let content: React.ReactNode;
  if (!reference) content = <StatePanel icon="alertCircle" title={copy.notYours}/>;
  else if (loading || (signedIn && !thread && !error)) content = <View testID="care-loading" style={{ gap: space.md }}>
    <Txt kind="small" accessibilityLiveRegion="polite">{copy.loading}</Txt>
    <Skeleton width="62%" height={44} rounded={radius.lg}/><Skeleton width="48%" height={44} rounded={radius.lg} style={{ alignSelf: endSide }}/>
  </View>;
  else if (error) content = error instanceof ApiError && error.code === 'support_requires_confirmed_booking'
    ? <StatePanel testID="care-not-confirmed" icon="hourglass" title={copy.notConfirmed} body={copy.notConfirmedBody}/>
    : error instanceof ApiError && (error.code === 'support_reference_not_found' || error.status === 404)
    ? <StatePanel icon="alertCircle" title={copy.notYours} body={copy.notYoursBody}/>
    : <ApiState error={error} retry={() => { setError(null); setAttempt(value => value + 1); }}/>;
  else if (thread) content = <View style={{ gap: space.xs }}>
    {empty && <View testID="care-empty" style={styles.empty}>
      <Txt kind="subheading" align="center">{copy.emptyTitle}</Txt>
      <Txt kind="small" align="center">{copy.emptyBody}</Txt>
      <View style={[styles.quick, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
        {quickReplies(intent, language).map(reply => <Chip key={reply} testID="care-quick" label={reply} onPress={() => setText(reply)}/>)}
      </View>
    </View>}
    {rows.map(row => row.kind === 'day'
      ? <Txt key={row.key} kind="micro" align="center" style={styles.day}>{row.label}</Txt>
      : <View key={row.key} testID={row.message.mine ? 'care-mine' : 'care-team'} style={{ alignSelf: row.message.mine ? endSide : startSide, maxWidth: '86%', marginTop: row.first ? space.sm : 0 }}>
        {!row.message.mine && row.first && <Txt kind="micro" tone="brand" style={{ marginBottom: 2, fontFamily: fonts.bold }}>{copy.team}</Txt>}
        <View style={[styles.bubble, row.message.mine ? styles.mine : styles.team,
          row.message.mine ? (rtl ? { borderBottomLeftRadius: row.last ? 6 : radius.lg } : { borderBottomRightRadius: row.last ? 6 : radius.lg })
            : (rtl ? { borderBottomRightRadius: row.last ? 6 : radius.lg } : { borderBottomLeftRadius: row.last ? 6 : radius.lg })]}>
          <Txt selectable kind="body" tone={row.message.mine ? 'onDark' : 'primary'} style={textDirection(row.message.body)}>{row.message.body}</Txt>
          {row.last && !!row.time && <Txt kind="micro" tone={row.message.mine ? 'onDarkMuted' : 'secondary'} align="end">{row.time}</Txt>}
        </View>
      </View>)}
    {outgoing.map(row => <Pressable key={row.clientId} testID={row.state === 'failed' ? 'care-failed' : 'care-sending'} disabled={row.state !== 'failed'}
      accessibilityRole={row.state === 'failed' ? 'button' : undefined} accessibilityLabel={row.state === 'failed' ? `${copy.failed}: ${row.body}` : undefined}
      onPress={() => void send(row.body, row.clientId)} style={{ alignSelf: endSide, maxWidth: '86%', marginTop: space.sm }}>
      <View style={[styles.bubble, styles.mine, { opacity: row.state === 'sending' ? 0.72 : 1 }, row.state === 'failed' && styles.failed]}>
        <Txt kind="body" tone={row.state === 'failed' ? 'danger' : 'onDark'} style={textDirection(row.body)}>{row.body}</Txt>
        <Row style={{ gap: 4, justifyContent: 'flex-end' }}>
          <Icon name={row.state === 'failed' ? 'refresh' : 'clock'} size={11} color={row.state === 'failed' ? color.danger : color.textOnDarkMuted}/>
          <Txt kind="micro" tone={row.state === 'failed' ? 'danger' : 'onDarkMuted'} accessibilityLiveRegion="polite">{row.state === 'failed' ? copy.failed : copy.sending}</Txt>
        </Row>
      </View>
    </Pressable>)}
    {thread.conversation.status === 'resolved' && <Txt kind="caption" align="center" style={{ marginTop: space.md }}>{copy.reopen}</Txt>}
  </View>;

  const statusTone = thread?.conversation.status === 'waiting' ? 'success' : thread?.conversation.status === 'resolved' ? 'neutral' : 'info';
  return <SafeAreaView edges={['top', 'bottom']} style={ui.screen}>
    <BrandHeader back/>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" contentContainerStyle={[ui.page, { gap: space.md, flexGrow: 1 }]}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: !reduced })}>
        <View testID="care-hero" style={styles.hero}>
          <Svg style={StyleSheet.absoluteFill} accessible={false}>
            <Defs><RadialGradient id="heroGlow" cx={rtl ? '12%' : '88%'} cy="0%" r="90%">
              <Stop offset="0" stopColor="#8E6BC0" stopOpacity="0.55"/><Stop offset="1" stopColor="#2D173A" stopOpacity="0"/>
            </RadialGradient></Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#heroGlow)"/>
          </Svg>
          <Row style={{ gap: space.md, alignItems: 'center' }}>
            <CareMark size={talking ? 44 : 56}/>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Txt kind={talking ? 'subheading' : 'heading'} tone="onDark" accessibilityRole="header">{copy.brand}</Txt>
              {!!thread?.conversation.hotelName && <Txt kind="small" tone="onDarkMuted" numberOfLines={2}>{thread.conversation.hotelName}</Txt>}
            </View>
          </Row>
          {/* Once the conversation is under way the header steps back: status and reference only. */}
          {talking && thread && <Row style={{ gap: space.sm, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge testID="care-status" tone={statusTone} label={copy.status[thread.conversation.status]}/>
          </Row>}
          {!talking && <>
            <Txt kind="small" tone="onDarkMuted">{copy.tagline}</Txt>
            <View style={[styles.promises, { flexDirection: rtl ? 'row-reverse' : 'row' }]}>
              {copy.promises.map((item, index) => <Row key={item} style={styles.promise}>
                <Icon name={(['trips', 'lock', 'chat'] as const)[index]} size={13} color="#C9B7F5"/>
                <Txt kind="micro" tone="onDark">{item}</Txt>
              </Row>)}
            </View>
          </>}
          {!!reference && <Txt selectable kind="micro" tone="onDarkMuted" numberOfLines={1} ellipsizeMode="middle"
            accessibilityLabel={`${copy.reference}: ${reference}`} style={{ writingDirection: 'ltr' }}>{copy.reference} · {reference}</Txt>}
        </View>
        {content}
      </ScrollView>
      {thread && <View style={[styles.composer, focused && styles.composerFocused]}>
        <Row style={{ gap: space.sm, alignItems: 'flex-end' }}>
          <TextInput testID="care-input" value={text} onChangeText={setText} multiline placeholder={copy.placeholder}
            placeholderTextColor={color.textSecondary} accessibilityLabel={copy.placeholder} maxLength={MESSAGE_LIMIT + 200}
            onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            style={[styles.input, { fontSize: input.fontSize, lineHeight: input.lineHeight, fontFamily: localizedFont(language, fonts.regular),
              textAlign: rtl ? 'right' : 'left', writingDirection: rtl ? 'rtl' : 'ltr' }]}/>
          <Pressable testID="care-send" accessibilityRole="button" accessibilityLabel={copy.send} accessibilityState={{ disabled: !canSend || tooLong }}
            disabled={!canSend || tooLong} onPress={() => void send(text)} hitSlop={6}
            style={state => [styles.send, (!canSend || tooLong) && styles.sendOff, state.pressed && { backgroundColor: color.actionPrimaryPressed }]}>
            <Icon name="send" size={20} color={color.onActionPrimary}/>
          </Pressable>
        </Row>
        {tooLong && <Txt kind="caption" tone="danger" accessibilityRole="alert">{copy.tooLong(MESSAGE_LIMIT)}</Txt>}
      </View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden', gap: space.sm, padding: space.lg, borderRadius: radius.xl, backgroundColor: color.bgBrand },
  promises: { flexWrap: 'wrap', gap: space.xs },
  promise: { gap: 5, paddingHorizontal: space.sm, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.10)' },
  empty: { gap: space.sm, alignItems: 'center', padding: space.lg, borderRadius: radius.lg, backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.borderCard },
  quick: { flexWrap: 'wrap', justifyContent: 'center', gap: space.xs, marginTop: space.xs },
  day: { alignSelf: 'center', marginTop: space.md, paddingHorizontal: space.sm, paddingVertical: 3, borderRadius: radius.pill, backgroundColor: color.bgSubtle, overflow: 'hidden' },
  bubble: { gap: 2, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.lg },
  mine: { backgroundColor: color.actionPrimary },
  team: { backgroundColor: color.bgSurface, borderWidth: 1, borderColor: color.borderCard },
  failed: { backgroundColor: color.dangerBg, borderWidth: 1, borderColor: color.dangerBorder },
  composer: { gap: space.xs, paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm, backgroundColor: color.bgSurface,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.border },
  composerFocused: { borderTopColor: color.borderSelected },
  input: { flex: 1, minHeight: 44, maxHeight: 140, paddingHorizontal: space.md, paddingVertical: 10, borderRadius: 22, backgroundColor: color.bgField, color: color.textPrimary },
  send: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: color.actionPrimary },
  sendOff: { backgroundColor: color.borderControl },
});
