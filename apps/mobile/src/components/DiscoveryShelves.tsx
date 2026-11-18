import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from './AppState';
import { Icon, Photo, Row, Txt } from './Primitives';
import { useSavedHotelCards } from './useSavedHotelCards';

const destinations = [
  { id: 'dubai', en: 'Dubai', ar: 'دبي', country: 'United Arab Emirates', countryAr: 'الإمارات', photo: require('../../assets/dubai-destination.jpg'), color: colors.lavenderMist },
  { id: 'istanbul', en: 'Istanbul', ar: 'إسطنبول', country: 'Türkiye', countryAr: 'تركيا', photo: require('../../assets/istanbul-destination.jpg'), color: colors.pistachioMist },
  { id: 'paris', en: 'Paris', ar: 'باريس', country: 'France', countryAr: 'فرنسا', photo: require('../../assets/paris-destination.jpg'), color: colors.apricot },
] as const;
export type DestinationId = typeof destinations[number]['id'];
type ChooseDestination = (id: DestinationId, name: string) => void;

export function DiscoveryHero({ cityId, choose }: { cityId: DestinationId; choose: ChooseDestination }) {
  const { rtl } = useLanguage();
  const router = useRouter();
  const city = destinations.find(item => item.id === cityId) || destinations[0];
  const name = rtl ? city.ar : city.en;
  return <View testID="search-hero" style={styles.hero}>
    <Image source={city.photo} accessible={false} resizeMode="cover" style={styles.heroPhoto}/>
    <Image source={require('../../assets/destination-shade.png')} accessible={false} resizeMode="stretch" style={styles.heroPhoto}/>
    <View style={styles.heroContent}>
      <Row style={{ justifyContent: 'flex-end' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={rtl ? 'ابحث عن إقامات في ' + name : 'Search stays in ' + name}
          onPress={() => choose(city.id, name)} style={styles.cityControl}>
          <Row style={styles.cityLink}><Icon name="pin" size={15}/><Txt kind="label">{name}</Txt></Row>
        </Pressable>
      </Row>
      <View style={{ gap: 0 }}>
      <Txt kind="title" accessibilityRole="header" style={styles.heroTitle}>
        {rtl ? 'وين نرتاح اليوم؟' : 'Where shall we stay?'}
      </Txt>
      <Row style={{ gap: 0 }}>
        <Pressable accessibilityRole="button" onPress={() => router.push('/membership')} style={styles.memberLink}>
          <Row style={{ gap: 6 }}><Txt kind="label" style={{ color: colors.surface }}>
            {rtl ? 'أسعار خاصة للأعضاء' : 'Private member rates'}</Txt><Icon name="chevron" size={14} color={colors.surface}/></Row>
        </Pressable>
      </Row>
      </View>
    </View>
  </View>;
}

export function DestinationPicks({ choose }: { choose: ChooseDestination }) {
  const { rtl } = useLanguage();
  return <View style={{ gap: 8 }}>
    <Txt kind="heading" accessibilityRole="header">{rtl ? 'استكشف الوجهات' : 'Explore destinations'}</Txt>
    <Row style={{ gap: 8, alignItems: 'stretch', flexWrap: 'wrap' }}>
      {destinations.map(city => {
        const name = rtl ? city.ar : city.en;
        return <Pressable key={city.id} testID={'destination-' + city.id} accessibilityRole="button"
          accessibilityLabel={rtl ? 'ابحث عن فنادق في ' + name : 'Find hotels in ' + name}
          onPress={() => choose(city.id, name)} style={({pressed}) => [styles.pick, { backgroundColor: city.color, opacity: pressed ? .8 : 1 }]}>
          <Image accessible={false} source={city.photo} resizeMode="cover" style={styles.pickPhoto}/>
          <View style={styles.pickLabel}><Txt kind="label">{name}</Txt><Txt kind="small">{rtl ? city.countryAr : city.country}</Txt></View>
        </Pressable>;
      })}
    </Row>
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
        <Row>{card.imageUrl && <View style={{ width: 64, borderRadius: 9, overflow: 'hidden' }}><Photo uri={card.imageUrl} alternatives={card.images} label={card.name} height={64} thumbnail/></View>}
          <View style={{ flex: 1, gap: 2 }}><Txt kind="label">{card.name}</Txt>{!!card.address && <Txt kind="small" numberOfLines={1}>{card.address}</Txt>}</View>
          <Icon name="chevron" size={16}/>
        </Row>
      </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  hero: { backgroundColor: colors.navy, borderRadius: 24, overflow: 'hidden' },
  heroPhoto: { position: 'absolute', width: '100%', height: '100%' },
  heroContent: { minHeight: 188, justifyContent: 'space-between', paddingTop: 4, paddingHorizontal: 16, paddingBottom: 11 },
  heroTitle: { color: colors.surface, fontSize: 33, lineHeight: 44, textShadowColor: '#271031', textShadowOffset: {width:0,height:1}, textShadowRadius: 3 },
  memberLink: { minHeight: 44, justifyContent: 'center' },
  cityControl: { minHeight: 44, justifyContent: 'center' },
  cityLink: { gap: 4, backgroundColor: colors.surface, borderRadius: 18, paddingHorizontal: 11, paddingVertical: 3 },
  pick: { flex: 1, minWidth: 83, borderRadius: 15, overflow: 'hidden' },
  pickPhoto: { width: '100%', height: 85 },
  pickLabel: { paddingHorizontal: 9, paddingVertical: 7 },
});
