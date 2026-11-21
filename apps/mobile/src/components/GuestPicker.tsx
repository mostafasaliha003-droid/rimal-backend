import React, { useLayoutEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import type { GuestRoom } from '../types';
import { useLanguage } from '../i18n';
import { colors, tokens } from '../theme';
import { Button, Field, IconButton, Row, Sheet, Txt } from './Primitives';
import { guestLine } from './format';
import { appendRoomWithSameCounts, childAgeInput, firstInvalidChildAge, isValidChildAge, type GuestRoomDraft } from './guestAgeModel';

type CountKind = 'adults' | 'children';
type EditorTarget = { roomIndex: number; childIndex?: number };

const copyByLanguage = {
  en: {
    repeat: 'Add a room with these guest counts',
    separateAges: 'Enter the ages of the children staying in the new room.',
    ageLabel: (room: number, child: number) => 'Room ' + room + ' · Age of child ' + child,
    ageError: (room: number, child: number) => 'Enter an age from 0 to 17 for child ' + child + ' in room ' + room + '.',
    step: (increase: boolean, kind: CountKind, room: number) => (increase ? '+ Add one ' : '− Remove one ')
      + (kind === 'adults' ? 'adult' : 'child') + (increase ? ' to room ' : ' from room ') + room,
  },
  ar: {
    repeat: 'إضافة غرفة بنفس عدد الضيوف',
    separateAges: 'أدخل أعمار الأطفال الذين سيقيمون في الغرفة الجديدة.',
    ageLabel: (room: number, child: number) => 'الغرفة ' + room + ' · عمر الطفل ' + child,
    ageError: (room: number, child: number) => 'أدخل عمراً من 0 إلى 17 سنة للطفل ' + child + ' في الغرفة ' + room + '.',
    step: (increase: boolean, kind: CountKind, room: number) => (increase ? '+ زيادة عدد ' : '− إنقاص عدد ')
      + (kind === 'adults' ? 'البالغين' : 'الأطفال') + ' في الغرفة ' + room,
  },
};

const ageId = (room: number, child: number) => 'guest-age-' + (room + 1) + '-' + (child + 1);

function Counter({ room, kind, count, onStep }: {
  room: number; kind: CountKind; count: number; onStep: (step: 1 | -1) => void;
}) {
  const { language, t } = useLanguage();
  const copy = copyByLanguage[language];
  return <View testID={'guest-' + kind + '-' + room}>
    <Row style={styles.counter}>
      <View style={styles.flex}>
        <Txt kind="bodyStrong">{t(kind)}</Txt>
        <Txt kind="caption">{kind === 'adults' ? (language === 'ar' ? '18 سنة فأكثر' : '18 and over') : (language === 'ar' ? 'من 0 إلى 17 سنة' : 'Ages 0–17')}</Txt>
      </View>
      <Row style={{ gap: tokens.space.sm }}>
        <IconButton variant="field" icon="minus" label={copy.step(false, kind, room)}
          disabled={count <= (kind === 'adults' ? 1 : 0)} onPress={() => onStep(-1)}/>
        <Txt accessibilityLiveRegion="polite" kind="subheading" style={styles.count}>{count}</Txt>
        <IconButton variant="field" icon="plus" label={copy.step(true, kind, room)}
          disabled={count >= (kind === 'adults' ? 6 : 4)} onPress={() => onStep(1)}/>
      </Row>
    </Row>
  </View>;
}

export default function GuestPicker({ visible, value, onClose, onChange }: {
  visible: boolean; value: GuestRoom[]; onClose: () => void; onChange: (rooms: GuestRoom[]) => void;
}) {
  const { language, t } = useLanguage();
  const copy = copyByLanguage[language];
  const [draft, setDraft] = useState<GuestRoomDraft[]>(() => value.map(room => ({ ...room, children: [...room.children] })));
  const [submitted, setSubmitted] = useState(false);
  const [target, setTarget] = useState<EditorTarget | null>(null);
  const inputs = useRef(new Map<string, React.ComponentRef<typeof TextInput>>());
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);

  useLayoutEffect(() => {
    if (!target) return;
    const input = target.childIndex === undefined ? undefined : inputs.current.get(ageId(target.roomIndex, target.childIndex));
    if (!input) {
      scroll.current?.scrollToEnd({ animated: false });
      return;
    }
    input.focus();
    const list = scroll.current;
    const content = list?.getInnerViewRef();
    if (!list || !content) return;
    let active = true;
    input.measureLayout(content, (_x, y) => {
      if (active && Number.isFinite(y)) list.scrollTo({ y: Math.max(0, y - 50), animated: false });
    }, () => {});
    return () => { active = false; };
  }, [target]);

  const updateRoom = (index: number, update: (room: GuestRoomDraft) => GuestRoomDraft) =>
    setDraft(rooms => rooms.map((room, position) => position === index ? update(room) : room));

  const step = (index: number, kind: CountKind, delta: 1 | -1) => updateRoom(index, room => {
    if (kind === 'adults') return { ...room, adults: Math.max(1, Math.min(6, room.adults + delta)) };
    const count = Math.max(0, Math.min(4, room.children.length + delta));
    return { ...room, children: Array.from({ length: count }, (_, child) => room.children[child] ?? '') };
  });

  const appendRoom = (sourceIndex?: number) => {
    if (draft.length >= 9) return;
    const next = sourceIndex === undefined ? [...draft, { adults: 2, children: [] }] : appendRoomWithSameCounts(draft, sourceIndex);
    if (next === draft) return;
    const roomIndex = next.length - 1;
    setDraft(next);
    setTarget({ roomIndex, childIndex: next[roomIndex].children.length ? 0 : undefined });
  };

  const submit = () => {
    const first = firstInvalidChildAge(draft);
    if (first) {
      setSubmitted(true);
      setTarget(first);
      return;
    }
    onChange(draft.map(room => ({ adults: room.adults, children: room.children.filter(isValidChildAge) })));
    onClose();
  };

  return <Sheet visible={visible} testID="guest-picker" title={t('guests')} onClose={onClose} closeLabel={t('close')} scrollRef={scroll}
    footer={<Button label={t('done')} onPress={submit}
      title={`${t('done')} · ${guestLine(draft.map(room => ({ adults: room.adults, children: room.children.map(() => 0) })), language)}`}/>}>
    {draft.map((room, index) => {
      const number = index + 1;
      const roomLabel = t('room') + ' ' + number;
      return <View key={index} testID={'guest-room-' + number} style={[styles.room, index > 0 && styles.roomRule]}>
        {(draft.length > 1 || index > 0) && <Row style={styles.counter}>
          <Txt kind="label" accessibilityRole="header" style={styles.flex}>{roomLabel}</Txt>
          {draft.length > 1 && <Button compact variant="quiet" icon="trash" title={t('removeRoom')} label={t('removeRoom') + ' · ' + roomLabel}
            onPress={() => setDraft(rooms => rooms.filter((_, position) => position !== index))}/>}
        </Row>}
        <Counter room={number} kind="adults" count={room.adults} onStep={delta => step(index, 'adults', delta)}/>
        <Counter room={number} kind="children" count={room.children.length} onStep={delta => step(index, 'children', delta)}/>
        {room.children.map((age, child) => {
          const id = ageId(index, child);
          return <Field key={child} testID={id} errorId={id + '-error'} ltr keyboardType="number-pad" maxLength={2}
            inputRef={input => { if (input) inputs.current.set(id, input); else inputs.current.delete(id); }}
            label={copy.ageLabel(number, child + 1)} error={submitted && !isValidChildAge(age) ? copy.ageError(number, child + 1) : undefined}
            value={String(age)} placeholder="0–17" onChangeText={text => updateRoom(index, current => ({
              ...current, children: current.children.map((value, position) => position === child ? childAgeInput(text) : value),
            }))}/>;
        })}
        {draft.length < 9 && (room.adults !== 2 || room.children.length > 0) && <View testID={'guest-repeat-' + number} style={styles.repeat}>
          <Button compact variant="secondary" title={copy.repeat} label={copy.repeat + ' · ' + roomLabel} onPress={() => appendRoom(index)}/>
          {room.children.length > 0 && <Txt kind="small">{copy.separateAges}</Txt>}
        </View>}
      </View>;
    })}
    {draft.length < 9 && <Button variant="secondary" icon="plus" title={t('addRoom')} onPress={() => appendRoom()}/>}
  </Sheet>;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  counter: { justifyContent: 'space-between' },
  count: { minWidth: 24, textAlign: 'center' },
  room: { gap: tokens.space.md },
  roomRule: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: tokens.space.md },
  repeat: { gap: tokens.space.sm },
});
