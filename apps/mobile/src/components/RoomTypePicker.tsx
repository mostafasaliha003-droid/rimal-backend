import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { Field, Icon, Photo, Row, Txt } from './Primitives';
import type { RoomChoiceGroup } from './roomChoiceModel';
import { rateCopy } from './roomRateFacts';

export type RoomTypeSelection = Pick<RoomChoiceGroup, 'key' | 'name'>;

export default function RoomTypePicker({ groups, value, onChange }: {
  groups: RoomChoiceGroup[]; value: RoomTypeSelection | null; onChange: (value: RoomTypeSelection | null) => void;
}) {
  const { language } = useLanguage();
  const ar = language === 'ar';
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const title = ar ? 'نوع الغرفة' : 'Room type';
  const all = ar ? 'كل أنواع الغرف' : 'All room types';
  const visible = groups.filter(group => group.name.toLowerCase().includes(search.trim().toLowerCase()));
  const select = (group: RoomChoiceGroup | null) => {
    onChange(group ? { key: group.key, name: group.name } : null);
    setOpen(false);
  };
  return <>
    <Pressable testID="room-type-picker" accessibilityRole="button" accessibilityState={{ expanded: open }}
      accessibilityLabel={value ? title + ' · ' + value.name : title} onPress={() => { setSearch(''); setOpen(true); }}
      style={[styles.trigger, value && styles.picked]}>
      <Row style={{ gap: 6 }}><Icon name="bed" size={17}/><Txt kind="label" numberOfLines={2} style={{ flexShrink: 1 }}>{value?.name || title}</Txt></Row>
    </Pressable>
    {open && <Modal visible transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={styles.scrim} edges={['top','bottom','left','right']}>
        <View testID="room-type-sheet" accessibilityViewIsModal style={[styles.sheet, { maxHeight: height * .88 }]}>
          <Row style={styles.heading}><Txt kind="heading" accessibilityRole="header" style={{ flex: 1 }}>{ar ? 'أي غرفة تناسبك؟' : 'Choose your room type'}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={ar ? 'إغلاق أنواع الغرف' : 'Close room types'} onPress={() => setOpen(false)} style={styles.close}>
              <Icon name="close" size={19}/></Pressable></Row>
          {groups.length > 8 && <Field label={ar ? 'ابحث باسم الغرفة' : 'Find a room by name'} value={search} onChangeText={setSearch} autoCorrect={false}/>}
          <FlatList data={visible} keyExtractor={group => group.key} keyboardShouldPersistTaps="handled" style={{ flexShrink: 1 }}
            ListHeaderComponent={<Pressable testID="room-type-all" accessibilityRole="button" accessibilityState={{ selected: !value }} aria-pressed={!value}
              onPress={() => select(null)} style={styles.all}><Row><Txt kind="label" style={{ flex: 1 }}>{all}</Txt>{!value && <Icon name="check" size={18}/>}</Row></Pressable>}
            ListEmptyComponent={<Txt kind="small" style={{ padding: 12 }}>{ar ? 'لا توجد غرف تطابق البحث الحالي.' : 'No rooms match this search.'}</Txt>}
            renderItem={({ item: group }) => {
              const preview = (group.lowestReviewable || group.entries[0]).offer;
              const image = preview.images[0];
              const chosen = value?.key === group.key;
              const price = group.fromPrice;
              return <Pressable testID={`room-type-${group.entries[0].index + 1}`} accessibilityRole="button" aria-pressed={chosen}
                accessibilityState={{ selected: chosen }} onPress={() => select(group)} style={[styles.item, chosen && styles.picked]}>
                <Row style={{ gap: 10 }}>
                  <View style={styles.thumb}>{image ? <Photo uri={image} alternatives={preview.images} label={group.name} room height={54} thumbnail/> : <Icon name="bed" size={23} color={colors.violetInk}/>}</View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Txt kind="label">{group.name}</Txt><Txt kind="small">{rateCopy(language).plans(group.entries.length)}</Txt>
                    {price && <Txt kind="small" style={{ color: colors.violetInk }}>{(ar ? 'لكل الليالي من ' : 'Full stay from ') + '\u2066' + price.currency + ' ' + price.amount + '\u2069'}</Txt>}
                  </View><Icon name={chosen ? 'check' : 'chevron'} size={16} color={colors.violetInk}/>
                </Row>
              </Pressable>;
            }}/>
        </View>
      </SafeAreaView>
    </Modal>}
  </>;
}

const styles = StyleSheet.create({
  trigger: { minHeight: 44, maxWidth: '100%', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 12, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1 },
  picked: { backgroundColor: colors.lavenderMist, borderColor: colors.grape },
  scrim: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(32,22,38,.48)' },
  sheet: { width: '100%', maxWidth: 600, backgroundColor: colors.canvas, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 14, gap: 8 },
  heading: { gap: 7 }, close: { width: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  all: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
  item: { padding: 10, marginVertical: 3, borderRadius: 14, borderColor: colors.border, borderWidth: 1, backgroundColor: colors.surface },
  thumb: { width: 54, height: 54, borderRadius: 10, backgroundColor: colors.softBlue, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
