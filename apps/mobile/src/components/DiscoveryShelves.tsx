import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from './AppState';
import { Icon, Photo, Row, Txt } from './Primitives';
import { useSavedHotelCards } from './useSavedHotelCards';

const destinations = [
  { id: 'dubai', en: 'Dubai', ar: 'دبي', country: 'United Arab Emirates', countryAr: 'الإمارات', place: 'Dubai Marina', placeAr: 'دبي مارينا', title: 'Dubai at dusk', titleAr: 'دبي عند الغروب', cover: require('../../assets/dubai-marina-dusk.jpg'), photo: require('../../assets/dubai-destination.jpg') },
  { id: 'istanbul', en: 'Istanbul', ar: 'إسطنبول', country: 'Türkiye', countryAr: 'تركيا', place: 'Ortaköy', placeAr: 'أورتاكوي', title: 'On the Bosphorus', titleAr: 'على ضفاف البوسفور', cover: require('../../assets/istanbul-destination.jpg'), photo: require('../../assets/istanbul-destination.jpg') },
  { id: 'paris', en: 'Paris', ar: 'باريس', country: 'France', countryAr: 'فرنسا', place: 'Eiffel Tower', placeAr: 'برج إيفل', title: 'A day in Paris', titleAr: 'يوم في باريس', cover: require('../../assets/paris-destination.jpg'), photo: require('../../assets/paris-destination.jpg') },
] as const;
export type DestinationId = typeof destinations[number]['id'];
type ChooseDestination = (id: DestinationId, name: string) => void;

// The suggestion endpoint searches the English supplier index and localizes its response.
export function destinationLookupName(value: string) {
  return destinations.find(city => value.trim() === city.ar)?.en ?? value.trim();
}

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
    <View style={[styles.heroContent, {minHeight: width >= 640 ? 330 : width < 370 ? 230 : 254}]}>
      <Row style={{justifyContent:'space-between', alignItems:'flex-start'}}>
        <Row style={styles.place}><Icon name="pin" size={14} color={colors.surface}/>
          <Txt kind="label" style={styles.location}>{rtl ? city.placeAr : city.place}</Txt></Row>
        <Pressable accessibilityRole="button" testID="discovery-next-city"
          accessibilityLabel={rtl ? 'اعرض وجهة ' + next.ar : 'Show ' + next.en}
          onPress={() => preview(next.id)} style={({pressed}) => [styles.nextCity, { opacity: pressed ? .75 : 1 }]}>
          <Row style={{gap:7}}>
            <Row style={{gap:3}}>{destinations.map(item => <View key={item.id} style={[styles.dot, item.id === city.id && styles.activeDot]}/>)}</Row>
            <Icon name="chevron" size={14} color={colors.surface}/>
          </Row>
        </Pressable>
      </Row>
      <View style={{ gap: 3 }}>
        <Txt kind="title" accessibilityRole="header" style={[styles.heroTitle, fontScale > 1.35 && {fontSize:30,lineHeight:42}]}>
          {rtl ? city.titleAr : city.title}
        </Txt>
        <Row><Pressable accessibilityRole="button" testID="discovery-search-city"
          accessibilityLabel={rtl ? 'ابحث عن إقامات في ' + name : 'Search stays in ' + name}
          onPress={() => choose(city.id, name)} style={({pressed}) => [styles.cityControl, {opacity:pressed ? .75 : 1}]}>
          <Row style={{gap:10}}><Txt kind="label" style={styles.heroLink}>{rtl ? 'اكتشف فنادق ' + name : 'Explore hotels in ' + name}</Txt>
            <Icon name="chevron" size={14} color={colors.pistachio}/></Row>
        </Pressable></Row>
      </View>
    </View>
  </View>;
}

export function DestinationPicks({ choose }: { choose: ChooseDestination }) {
  const { rtl } = useLanguage();
  const {width, fontScale} = useWindowDimensions();
  const wide = width >= 600;
  const tile = (city: typeof destinations[number], featured = false) => {
    const name = rtl ? city.ar : city.en;
    return <Pressable key={city.id} testID={'destination-' + city.id} accessibilityRole="button"
      accessibilityLabel={rtl ? 'ابحث عن فنادق في ' + name : 'Find hotels in ' + name}
      onPress={() => choose(city.id, name)} style={({pressed}) => [styles.pick, {
        minHeight: wide ? 175 : featured ? 204 : 96, opacity: pressed ? .82 : 1,
      }]}>
      <Image accessible={false} source={city.photo} resizeMode="cover" style={styles.heroPhoto}/>
      <Image accessible={false} source={require('../../assets/destination-shade.png')} resizeMode="stretch" style={styles.heroPhoto}/>
      <View style={styles.pickLabel}>
        <Txt kind="label" style={[styles.tileTitle, featured && {fontSize:25,lineHeight:34}]}>{name}</Txt>
        <Txt kind="small" style={styles.tileCountry}>{rtl ? city.countryAr : city.country}</Txt>
      </View>
    </Pressable>;
  };
  return <View style={{ gap: 11 }}>
    <Txt kind="heading" accessibilityRole="header" style={styles.sectionTitle}>{rtl ? 'استكشف الوجهات' : 'Explore destinations'}</Txt>
    {wide || fontScale > 1.45
      ? <Row style={{gap:9, alignItems:'stretch', ...(wide ? {} : {flexDirection:'column'})}}>{destinations.map(city => tile(city))}</Row>
      : <Row style={{gap:9, alignItems:'stretch'}}>
          {tile(destinations[1], true)}
          <View style={{flex:.9, gap:9}}>{tile(destinations[2])}{tile(destinations[0])}</View>
        </Row>}
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
  hero: { backgroundColor: colors.navy, overflow: 'hidden' },
  heroPhoto: { position: 'absolute', width: '100%', height: '100%' },
  heroContent: { justifyContent:'space-between', paddingHorizontal:20, paddingTop:12, paddingBottom:27 },
  heroTitle: { color:colors.surface, fontSize:39, lineHeight:52 },
  place: { gap:5, paddingHorizontal:10, minHeight:31, borderRadius:16, backgroundColor:'rgba(32,22,38,0.79)' },
  location: { color:colors.surface, fontSize:12, lineHeight:19 },
  nextCity: { minHeight:44, minWidth:62, alignItems:'center', justifyContent:'center', borderRadius:24, backgroundColor:'rgba(32,22,38,0.79)' },
  dot: { width:4, height:4, borderRadius:4, backgroundColor:colors.lilac },
  activeDot: { width:13, backgroundColor:colors.surface },
  cityControl: { minHeight:44, justifyContent:'center' },
  heroLink: {color:colors.pistachio, fontSize:15, lineHeight:22},
  sectionTitle: {fontSize:23, lineHeight:32},
  pick: { flex:1, borderRadius:18, overflow:'hidden', justifyContent:'flex-end', backgroundColor:colors.primary },
  pickLabel: { paddingHorizontal:12, paddingVertical:9 },
  tileTitle: {color:colors.surface, fontSize:18, lineHeight:24},
  tileCountry: {color:colors.surface, fontSize:13, lineHeight:19},
});
