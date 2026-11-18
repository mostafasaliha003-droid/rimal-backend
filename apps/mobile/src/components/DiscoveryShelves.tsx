import React, { useMemo } from 'react';
import { Image, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { useAppState } from './AppState';
import { Photo, Row, Txt } from './Primitives';
import { useSavedHotelCards } from './useSavedHotelCards';

export default function DiscoveryShelves({ chooseDubai }: { chooseDubai: () => void }) {
  const { language, rtl, t } = useLanguage();
  const router = useRouter();
  const { saved, savedReady } = useAppState();
  const { status, sessionRevision } = useAuth();
  const ids = useMemo(() => savedReady ? saved.slice(0, 2) : [], [saved, savedReady]);
  const { cards } = useSavedHotelCards(ids, language, status, sessionRevision);
  return <View style={{ gap: 14 }}>
    {cards.size > 0 && <><Txt kind="heading" accessibilityRole="header">{t('saved')}</Txt>
      {Array.from(cards.values()).map(card => <Pressable key={card.hid} accessibilityRole="button"
        accessibilityLabel={card.name} onPress={() => router.navigate('/saved')}
        style={[ui.card, { overflow: 'hidden', padding: 0, gap: 0 }]}>
        <Photo uri={card.imageUrl} label={card.name} height={150}/>
        <View style={{ padding: 14 }}><Txt kind="heading">{card.name}</Txt>{!!card.address && <Txt kind="small">{card.address}</Txt>}</View>
      </Pressable>)}</>}
    <Txt kind="heading" accessibilityRole="header">{rtl ? 'استكشف الوجهات' : 'Explore destinations'}</Txt>
    <Pressable accessibilityRole="button" accessibilityLabel={rtl ? 'ابحث عن إقامات في دبي' : 'Search stays in Dubai'} onPress={chooseDubai}
      style={[ui.card, { padding: 0, gap: 0, overflow: 'hidden' }]}>
      <Image source={require('../../assets/dubai-destination.jpg')} accessibilityLabel={rtl ? 'أفق دبي' : 'Dubai skyline'}
        resizeMode="cover" style={{ width: '100%', height: 165 }}/>
      <Row style={{ padding: 14, justifyContent: 'space-between' }}>
        <View><Txt kind="heading">{rtl ? 'دبي' : 'Dubai'}</Txt><Txt kind="small">{rtl ? 'الإمارات العربية المتحدة' : 'United Arab Emirates'}</Txt></View>
        <Txt kind="heading" style={{ color: colors.primary }}>{rtl ? '←' : '→'}</Txt>
      </Row>
    </Pressable>
  </View>;
}
