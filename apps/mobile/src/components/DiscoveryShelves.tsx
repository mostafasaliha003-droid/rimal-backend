import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from './AppState';
import { Icon, Photo, Row, Txt } from './Primitives';
import { useSavedHotelCards } from './useSavedHotelCards';

export function DiscoveryHero({ chooseDubai }: { chooseDubai: () => void }) {
  const { rtl } = useLanguage();
  const router = useRouter();
  return <View testID="search-hero" style={styles.hero}>
    <Image source={require('../../assets/dubai-destination.jpg')} accessible={false} resizeMode="cover" style={styles.heroPhoto}/>
    <View style={styles.scrim}/>
    <View style={styles.heroContent}>
      <Txt kind="title" accessibilityRole="header" style={styles.heroTitle}>
        {rtl ? 'وين نرتاح اليوم؟' : 'Where shall we stay?'}
      </Txt>
      <Row style={styles.heroLinks}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/membership')} style={styles.memberLink}>
          <Row style={{ gap: 4 }}><Txt kind="label" style={{ color: colors.surface }}>
            {rtl ? 'أسعار خاصة للأعضاء' : 'Private member rates'}</Txt><Icon name="chevron" size={14} color={colors.surface}/></Row>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={rtl ? 'ابحث عن إقامات في دبي' : 'Search stays in Dubai'}
          onPress={chooseDubai} style={styles.cityLink}>
          <Row style={{ gap: 4 }}><Icon name="pin" size={15} color={colors.surface}/><Txt kind="label" style={{ color: colors.surface }}>
            {rtl ? 'دبي' : 'Dubai'}</Txt></Row>
        </Pressable>
      </Row>
    </View>
  </View>;
}

export default function DiscoveryShelves() {
  const { language, t } = useLanguage();
  const router = useRouter();
  const { saved, savedReady } = useAppState();
  const { status, sessionRevision } = useAuth();
  const ids = useMemo(() => savedReady ? saved.slice(0, 2) : [], [saved, savedReady]);
  const { cards } = useSavedHotelCards(ids, language, status, sessionRevision);
  if (!cards.size) return null;
  return <View style={{ gap: 8 }}>
    <Txt kind="heading" accessibilityRole="header">{t('saved')}</Txt>
      {Array.from(cards.values()).map(card => <Pressable key={card.hid} accessibilityRole="button"
        accessibilityLabel={`${t('saved')}: ${card.name}`} onPress={() => router.navigate('/saved')}
        style={[ui.card, { padding: 10 }]}>
        <Row>{card.imageUrl && <View style={{ width: 64, borderRadius: 9, overflow: 'hidden' }}><Photo uri={card.imageUrl} label={card.name} height={64}/></View>}
          <View style={{ flex: 1, gap: 2 }}><Txt kind="label">{card.name}</Txt>{!!card.address && <Txt kind="small" numberOfLines={1}>{card.address}</Txt>}</View>
          <Icon name="chevron" size={16}/>
        </Row>
      </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.navy, borderRadius: 20, overflow: 'hidden' },
  heroPhoto: { position: 'absolute', width: '100%', height: '100%' },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(28,14,39,0.6)' },
  heroContent: { minHeight: 150, justifyContent: 'flex-end', paddingTop: 36, paddingHorizontal: 16, paddingBottom: 12 },
  heroTitle: { color: colors.surface, fontSize: 29, lineHeight: 41 },
  heroLinks: { gap: 4, justifyContent: 'space-between', flexWrap: 'wrap' },
  memberLink: { minHeight: 48, justifyContent: 'center' },
  cityLink: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
});
