import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { Icon, Photo, Row, Txt } from './Primitives';
import { roomChoiceCopy } from './roomChoiceCopy';

export default function HotelGallery({ images, name, room = false, thumbnail = false }: {
  images: readonly string[]; name: string; room?: boolean; thumbnail?: boolean;
}) {
  const { language, rtl, t } = useLanguage();
  const copy = roomChoiceCopy(language);
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const available = images.filter(uri => !failed.has(uri));
  const current = Math.min(index, Math.max(0, available.length - 1));
  const uri = available[current];
  const count = uri ? copy.photo(current + 1, available.length) : '';
  const label = room ? (rtl ? 'صور الغرفة' : 'Room photos') : (rtl ? 'صور الفندق' : 'Hotel photos');
  const caption = images.length ? (rtl ? 'تعذّر تحميل الصور' : 'Photos unavailable') : t(room ? 'roomPhotoUnknown' : 'photoUnknown');
  const reject = (source: string) => setFailed(previous => new Set(previous).add(source));
  const navigate = (next: boolean) => {
    const disabled = next ? current >= available.length - 1 : current === 0;
    return <Pressable accessibilityRole="button" accessibilityLabel={next ? copy.nextPhoto : copy.previousPhoto}
      accessibilityState={{ disabled }} disabled={disabled} onPress={() => setIndex(current + (next ? 1 : -1))}
      style={[styles.arrow, { opacity: disabled ? 0.48 : 1 }]}>
      <Icon name={next ? 'chevron' : 'back'} size={19} color={colors.navy}/>
    </Pressable>;
  };
  if (!uri && !expanded) {
    return <View style={[styles.empty, thumbnail && { paddingHorizontal: 4, minHeight: 78 }]}>
      <Icon name={room ? 'bed' : 'pin'} size={18} color={colors.muted}/>
      <Txt kind="small" style={{ textAlign: 'center', ...(thumbnail && { fontSize: 12, lineHeight: 16 }) }}>{caption}</Txt>
    </View>;
  }
  return <>
    <View style={[styles.gallery, thumbnail && { borderRadius: 11 }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={label + ' · ' + name} onPress={() => setExpanded(true)}>
        <Photo uri={uri} room={room} label={name} height={thumbnail ? 78 : Math.min(230, Math.max(150, width * .44))} onFailed={reject}/>
      </Pressable>
      {!thumbnail && available.length > 1 && <>
        <View style={[styles.edge, rtl ? { right: 8 } : { left: 8 }]}>{navigate(false)}</View>
        <View style={[styles.edge, rtl ? { left: 8 } : { right: 8 }]}>{navigate(true)}</View>
        <View pointerEvents="none" style={[styles.count, rtl ? { left: 8 } : { right: 8 }]}>
          <Txt kind="small" style={{ color: colors.surface }}>{count}</Txt>
        </View>
      </>}
    </View>
    {expanded && <Modal transparent={false} visible animationType="fade" onRequestClose={() => setExpanded(false)}>
      <SafeAreaView edges={['top','bottom','left','right']} style={styles.viewer}>
        <View accessibilityViewIsModal style={{ flex: 1 }}>
          <Row style={styles.bar}>
            <View style={{ flex: 1, gap: 1 }}><Txt kind="small" style={{ color: colors.surface }}>{label}</Txt>
              <Txt kind="label" style={{ color: colors.surface }}>{name}</Txt></View>
            <Pressable accessibilityRole="button" accessibilityLabel={rtl ? 'إغلاق الصور' : 'Close photos'}
              onPress={() => setExpanded(false)} style={styles.arrow}><Icon name="close" size={20}/></Pressable>
          </Row>
          <View style={{ flex: 1, justifyContent: 'center' }}>
            {uri ? <Photo uri={uri} label={name} height="100%" room={room} contain onFailed={reject}/>
              : <Txt style={{ textAlign: 'center', color: colors.surface }}>{caption}</Txt>}
          </View>
          {uri && <Row style={{ ...styles.bar, justifyContent: 'center', gap: 20 }}>
            {available.length > 1 && navigate(false)}
            <Txt accessibilityLiveRegion="polite" kind="label" style={{ color: colors.surface }}>{count}</Txt>
            {available.length > 1 && navigate(true)}
          </Row>}
        </View>
      </SafeAreaView>
    </Modal>}
  </>;
}

const styles = StyleSheet.create({
  gallery: { borderRadius: 17, overflow: 'hidden', backgroundColor: colors.softBlue },
  viewer: { flex: 1, backgroundColor: colors.ink, direction: 'ltr' },
  bar: { paddingVertical: 10, paddingHorizontal: 16, gap: 10 },
  arrow: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  edge: { position: 'absolute', top: '50%', marginTop: -23 },
  count: { position: 'absolute', bottom: 7, borderRadius: 15, backgroundColor: 'rgba(30,20,37,.8)', paddingVertical: 2, paddingHorizontal: 9 },
  empty: { minHeight: 48, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.softBlue, borderRadius: 11, padding: 8, gap: 3 },
});
