import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from './AppState';
import { Icon, Photo, Row, Txt } from './Primitives';
import { useSavedHotelCards } from './useSavedHotelCards';
import { featuredCities, type DestinationId } from './searchJourneyModel';

const destinations = [
  { id: 'dubai', ...featuredCities.dubai, place: 'Dubai Marina', placeAr: 'مرسى دبي', title: 'Dubai at dusk', titleAr: 'دبي عند الغروب', cover: require('../../assets/dubai-marina-dusk.jpg'), photo: require('../../assets/dubai-destination.jpg') },
  { id: 'istanbul', ...featuredCities.istanbul, place: 'Ortaköy', placeAr: 'أورتاكوي', title: 'On the Bosphorus', titleAr: 'على ضفاف البوسفور', cover: require('../../assets/istanbul-destination.jpg'), photo: require('../../assets/istanbul-destination.jpg') },
  { id: 'paris', ...featuredCities.paris, place: 'Eiffel Tower', placeAr: 'برج إيفل', title: 'A day in Paris', titleAr: 'يوم في باريس', cover: require('../../assets/paris-destination.jpg'), photo: require('../../assets/paris-destination.jpg') },
] as const;
type ChooseDestination = (id: DestinationId, name: string) => void;

export function DiscoveryHero({ cityId, preview, choose }: { cityId: DestinationId; preview: (id: DestinationId) => void; choose: ChooseDestination }) {
  const { rtl } = useLanguage();
  const { width, fontScale } = useWindowDimensions();
  const index = destinations.findIndex(item => item.id === cityId);
  const city = destinations[index];
  const name = rtl ? city.ar : city.en;
  const next = destinations[(index + 1) % destinations.length];
  return <View testID="search-hero" style={styles.hero}>
    <Image key={city.id} source={city.cover} accessible={false} resizeMode="cover" style={styles.heroPhoto}/>
    <Image source={require('../../assets/destination-shade.png')} accessible={false} resizeMode="stretch" style={styles.heroPhoto}/>
    <View style={[styles.heroContent, {minHeight: width >= 640 ? 295 : width < 370 ? 196 : 216}]}>
      <Row style={{justifyContent:'space-between', flexWrap:'wrap'}}>
        <Row style={styles.place}><Icon name="pin" size={14} color={colors.surface}/>
          <Txt kind="label" style={styles.location}>{rtl ? city.placeAr : city.place}</Txt></Row>
        <Pressable accessibilityRole="button" testID="discovery-next-city"
          accessibilityLabel={rtl ? 'اعرض وجهة ' + next.ar : 'Show ' + next.en}
          onPress={() => preview(next.id)} style={({pressed}) => [styles.nextCity, { opacity: pressed ? .75 : 1 }]}>
          <Row style={{gap:5}}>
            <Txt kind="label" style={styles.location}>{rtl ? 'التالية' : 'Next'}</Txt>
            <Icon name="chevron" size={14} color={colors.surface}/>
          </Row>
        </Pressable>
      </Row>
      <Pressable accessibilityRole="button" testID="discovery-search-city"
          accessibilityLabel={rtl ? 'ابحث عن إقامات في ' + name : 'Search stays in ' + name}
          onPress={() => choose(city.id, name)} style={({pressed}) => [styles.cityControl, {opacity:pressed ? .75 : 1}]}>
        <Row style={{gap:12}}>
          <View style={{flex:1}}>
            <Txt kind="title" style={[styles.heroTitle, fontScale > 1.35 && {fontSize:28,lineHeight:38}]}>{rtl ? city.titleAr : city.title}</Txt>
            <Txt kind="label" style={styles.heroLink}>{rtl ? 'اكتشف فنادق ' + name : 'Explore hotels in ' + name}</Txt>
          </View>
          <View style={styles.heroArrow}><Icon name="chevron" size={19} color={colors.primary}/></View>
        </Row>
      </Pressable>
    </View>
  </View>;
}

export function DestinationPicks({ choose }: { choose: ChooseDestination }) {
  const { rtl } = useLanguage();
  const {width, fontScale} = useWindowDimensions();
  const stacked = fontScale > 1.45 || width < 335;
  const tile = (city: typeof destinations[number]) => {
    const name = rtl ? city.ar : city.en;
    return <Pressable key={city.id} testID={'destination-' + city.id} accessibilityRole="button"
      accessibilityLabel={rtl ? 'ابحث عن فنادق في ' + name : 'Find hotels in ' + name}
      onPress={() => choose(city.id, name)} style={({pressed}) => [styles.pick, {opacity: pressed ? .8 : 1}]}>
      <View style={[styles.pickPhoto, {aspectRatio:stacked ? 3.2 : width >= 600 ? 1.55 : 0.95}]}>
        <Image accessible={false} source={city.photo} resizeMode="cover" style={styles.heroPhoto}/>
      </View>
      <Txt kind="label" style={styles.tileTitle}>{name}</Txt>
    </Pressable>;
  };
  return <View style={{ gap: 11 }}>
    <Txt kind="heading" accessibilityRole="header" style={styles.sectionTitle}>{rtl ? 'استكشف الوجهات' : 'Explore destinations'}</Txt>
    <Row style={{gap:9, alignItems:'stretch', ...(stacked ? {flexDirection:'column'} : {})}}>{destinations.map(tile)}</Row>
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
  hero: { backgroundColor: colors.navy, overflow: 'hidden', borderRadius:22 },
  heroPhoto: { position: 'absolute', width: '100%', height: '100%' },
  heroContent: { justifyContent:'space-between', padding:14, paddingBottom:24, gap:18 },
  heroTitle: { color:colors.surface, fontSize:33, lineHeight:45 },
  place: { gap:5, paddingHorizontal:10, minHeight:31, borderRadius:16, backgroundColor:'rgba(32,22,38,0.79)' },
  location: { color:colors.surface, fontSize:13, lineHeight:20 },
  nextCity: { minHeight:44, paddingHorizontal:12, alignItems:'center', justifyContent:'center', borderRadius:24, backgroundColor:'rgba(32,22,38,0.79)' },
  cityControl: { minHeight:44, justifyContent:'center' },
  heroArrow: {width:36, height:36, borderRadius:18, backgroundColor:colors.pistachio, alignItems:'center', justifyContent:'center'},
  heroLink: {color:colors.pistachio, fontSize:15, lineHeight:22},
  sectionTitle: {fontSize:23, lineHeight:32},
  pick: { flex:1, gap:4 },
  pickPhoto: { width:'100%', borderRadius:15, overflow:'hidden', backgroundColor:colors.pistachioMist },
  tileTitle: { color:colors.primary, fontSize:16, lineHeight:24, paddingHorizontal:3 },
});
