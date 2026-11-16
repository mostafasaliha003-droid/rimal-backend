import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { api, APP_ENV, bookingWebsiteUrl } from '../api';
import { useAuth } from '../auth';
import type { HotelDetails, RoomOffer } from '../types';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import BrandHeader, { EnvironmentBanner } from '../components/BrandHeader';
import { useAppState } from '../components/AppState';
import ApiState from '../components/ApiState';
import { Button, MoneyText, Photo, Row, StatePanel, Txt } from '../components/Primitives';
import Cancellation from '../components/Cancellation';
import Policies from '../components/Policies';
import Taxes from '../components/Taxes';

export default function HotelScreen() {
  const { hid: parameter } = useLocalSearchParams<{hid:string}>(); const hid=Number(parameter); const { criteria, saved, toggleSaved, savedReady }=useAppState(); const {language,t}=useLanguage(); const {user}=useAuth(); const router=useRouter(); const {width}=useWindowDimensions();
  const [result,setResult]=useState<{key:string;hotel:HotelDetails|null;error:unknown}>({key:'',hotel:null,error:null}); const [refresh,recheck]=useState(0); const [selected,setSelected]=useState<RoomOffer|null>(null); const [handoffError,setHandoffError]=useState(false); const [opening,setOpening]=useState(false); const [paging,setPaging]=useState({key:'',limit:8});
  const requestKey=JSON.stringify([hid,criteria,language,refresh,user?.email]);const hotel=result.key===requestKey?result.hotel:null;const error=result.key===requestKey?result.error:null;const loading=Boolean(criteria&&result.key!==requestKey);const limit=paging.key===requestKey?paging.limit:8;const setLimit=(limit:number)=>setPaging({key:requestKey,limit});
  useEffect(()=>{if(!criteria||!Number.isSafeInteger(hid)||hid<=0)return;const controller=new AbortController();api.getHotel(hid,criteria,language,controller.signal).then(hotel=>{if(!controller.signal.aborted)setResult({key:requestKey,hotel,error:null});}).catch(error=>{if(!controller.signal.aborted)setResult({key:requestKey,hotel:null,error});});return()=>controller.abort();},[hid,criteria,language,requestKey]);
  const handoff=async()=>{if(!criteria||!selected)return;setOpening(true);setHandoffError(false);try{await WebBrowser.openBrowserAsync(bookingWebsiteUrl(hid,criteria,language),{toolbarColor:colors.navy});setSelected(null);}catch{setHandoffError(true);}finally{setOpening(false);}};
  return <SafeAreaView edges={['top','bottom']} style={ui.screen}><BrandHeader back/><EnvironmentBanner/><ScrollView contentContainerStyle={ui.page}>
    {!criteria?<><StatePanel title={t('datesRequired')} body={t('datesRequiredBody')}/><Button title={t('search')} onPress={()=>router.push('/')}/></>:loading?<StatePanel title={t('loading')} busy/>:error?<ApiState error={error} retry={()=>recheck(value=>value+1)}/>:hotel?<>
      <Row style={{justifyContent:'space-between',alignItems:'flex-start'}}><Txt accessibilityRole="header" kind="title" style={{flex:1}}>{hotel.name}</Txt><Button compact variant="secondary" title={saved.includes(hid)?'♥':'♡'} hint={t(saved.includes(hid)?'removeSaved':'saveStay')} disabled={!savedReady} onPress={()=>toggleSaved(hid)}/></Row>{hotel.address&&<Txt kind="small">{hotel.address}</Txt>}
      <View style={{borderRadius:22,overflow:'hidden'}}>{hotel.images.length?<ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{direction:'ltr'}}>{hotel.images.map((uri,index)=><View key={`${uri}-${index}`} style={{width:Math.min(width-40,840)}}><Photo uri={uri} label={`${hotel.name} · ${index+1} ${t('of')} ${hotel.images.length}`} height={260}/></View>)}</ScrollView>:<Photo label={hotel.name} height={230}/>}</View>
      {criteria&&<View style={[ui.card,{backgroundColor:colors.softBlue,padding:16}]}><Txt kind="label" style={{writingDirection:'ltr'}}>{criteria.checkin} → {criteria.checkout}</Txt><Txt kind="small">{criteria.guests.reduce((sum,room)=>sum+room.adults+room.children.length,0)} {t('guests')} · {criteria.guests.length} {t('rooms')}</Txt></View>}
      <View style={ui.card}><Txt accessibilityRole="header" kind="heading">{t('about')}</Txt>{hotel.description.length?hotel.description.map((paragraph,index)=><Txt key={index}>{paragraph}</Txt>):<Txt kind="small">{t('noDescription')}</Txt>}</View>
      <View style={ui.card}><Txt accessibilityRole="header" kind="heading">{t('amenities')}</Txt>{hotel.amenities.length?hotel.amenities.map((amenity,index)=><Txt key={`${amenity}-${index}`}>· {amenity}</Txt>):<Txt kind="small">{t('noAmenities')}</Txt>}</View>
      <Txt accessibilityRole="header" kind="heading">{t('offers')} · {hotel.offers.length}</Txt>{hotel.offers.length===0&&<StatePanel title={t('noOffers')}/>}{hotel.offers.slice(0,limit).map(offer=><View key={offer.id} style={[ui.card,{padding:0,overflow:'hidden',gap:0}]}><Photo uri={offer.images[0]} room label={offer.name} height={185}/><View style={{padding:20,gap:15}}><Txt kind="heading">{offer.name}</Txt>{offer.meal&&<Txt kind="small">{t('meal')}: {offer.meal==='nomeal'?(language==='ar'?'بدون وجبات':'Room only'):offer.meal.replace(/[-_]/g,' ')}</Txt>}<View><Txt kind="small">{t('priceForStay')}</Txt><MoneyText large money={offer.price}/></View><Taxes taxes={offer.taxes}/><Cancellation offer={offer}/><Button variant="secondary" title={t('websiteCta')} onPress={()=>{setSelected(offer);setHandoffError(false);}}/></View></View>)}{limit<hotel.offers.length&&<Button variant="secondary" title={`${t('more')} (${hotel.offers.length-limit})`} onPress={()=>setLimit(limit+8)}/>}
      <Policies source={hotel.policies} extra={hotel.policyExtraInfo}/>
    </>:null}
  </ScrollView><Modal visible={selected!==null} transparent animationType="slide" onRequestClose={()=>{if(!opening)setSelected(null);}}><View style={{flex:1,justifyContent:'flex-end',backgroundColor:'#102A4380'}}><SafeAreaView edges={['bottom']} style={{padding:24,gap:16,backgroundColor:'#fff',borderTopLeftRadius:28,borderTopRightRadius:28,direction:'ltr'}} accessibilityViewIsModal><Txt accessibilityRole="header" kind="heading">{t('websiteTitle')}</Txt><Txt>{t('websiteBody')}</Txt>{APP_ENV!=='production'&&<Txt kind="small" style={{color:colors.goldInk}}>{t('websiteEnvironment')}</Txt>}{selected&&<Txt kind="small">{selected.name}</Txt>}{handoffError&&<Txt accessibilityRole="alert" style={{color:colors.red}}>{t('websiteError')}</Txt>}<Button title={t('websiteConfirm')} busy={opening} onPress={()=>void handoff()}/><Button variant="quiet" title={t('cancel')} disabled={opening} onPress={()=>setSelected(null)}/></SafeAreaView></View></Modal></SafeAreaView>;
}
