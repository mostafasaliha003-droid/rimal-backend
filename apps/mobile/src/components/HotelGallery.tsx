import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLanguage } from '../i18n';
import { colors } from '../theme';
import { Icon, Photo, Row, Txt } from './Primitives';
import { roomChoiceCopy } from './roomChoiceCopy';

export default function HotelGallery({ images, name, room = false }: {
  images: readonly string[]; name: string; room?: boolean;
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
  const sidePhotos = room ? [] : available.filter(source => source !== uri).slice(0, 2);
  const height = Math.min(room ? 215 : 320, Math.max(room ? 138 : 182, width * (room ? .39 : .52)));
  const open = (photo: string) => { setIndex(available.indexOf(photo)); setExpanded(true); };
  const navigate = (next: boolean) => {
    const disabled = next ? current >= available.length - 1 : current === 0;
    return <Pressable accessibilityRole="button" accessibilityLabel={next ? copy.nextPhoto : copy.previousPhoto}
      accessibilityState={{ disabled }} disabled={disabled} onPress={() => setIndex(current + (next ? 1 : -1))}
      style={[styles.arrow, { opacity: disabled ? 0.48 : 1 }]}>
      <Icon name={next ? 'chevron' : 'back'} size={19} color={colors.navy}/>
    </Pressable>;
  };
  if (!uri && !expanded) {
    return <Row style={styles.empty}>
      <Icon name={room ? 'bed' : 'pin'} size={18} color={colors.violetInk}/>
      <Txt kind="small" style={{ flexShrink: 1 }}>{caption}</Txt>
    </Row>;
  }
  return <>
    {uri && <Row style={{ ...styles.gallery, height }}>
      <Pressable accessibilityRole="button" accessibilityLabel={label + ' · ' + name} onPress={() => open(uri)}
        style={{ flex: 2, minWidth: 0, height }}>
        <Photo uri={uri} room={room} label={name} height={height} onFailed={reject}/>
        <View pointerEvents="none" style={[styles.count, rtl ? { right: 10 } : { left: 10 }]}>
          <Txt kind="label" style={styles.photoCount}>{available.length === 1 ? (rtl ? 'تكبير الصورة' : 'View photo') : count}</Txt>
        </View>
      </Pressable>
      {sidePhotos.length > 0 && <View style={{ flex: 1, height, gap: 3 }}>
        {sidePhotos.map(source => {
          const position = available.indexOf(source) + 1;
          const tileHeight = (height - (sidePhotos.length - 1) * 3) / sidePhotos.length;
          return <Pressable key={source} accessibilityRole="button" accessibilityLabel={label + ' · ' + copy.photo(position, available.length)}
            onPress={() => open(source)} style={{ height: tileHeight }}>
            <Photo uri={source} label={name} height={tileHeight} onFailed={reject}/>
          </Pressable>;
        })}
      </View>}
    </Row>}
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
  gallery: { gap: 3, borderRadius: 19, overflow: 'hidden', backgroundColor: colors.surface },
  viewer: { flex: 1, backgroundColor: colors.ink, direction: 'ltr' },
  bar: { paddingVertical: 10, paddingHorizontal: 16, gap: 10 },
  arrow: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  count: { position: 'absolute', bottom: 10, borderRadius: 16, backgroundColor: 'rgba(32,22,38,.84)', paddingVertical: 3, paddingHorizontal: 10 },
  photoCount: { fontSize: 12, lineHeight: 19, color: colors.surface },
  empty: { minHeight: 44, gap: 7, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: colors.softBlue, borderRadius: 12 },
});
