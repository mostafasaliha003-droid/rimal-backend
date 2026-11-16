import React from 'react';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLanguage } from '../../i18n';
import { colors, fonts } from '../../theme';
import { Icon } from '../../components/Primitives';

export default function TabLayout(){const {t,rtl}=useLanguage();const insets=useSafeAreaInsets();return <Tabs screenOptions={{headerShown:false,tabBarActiveTintColor:colors.blueStrong,tabBarInactiveTintColor:colors.muted,tabBarLabelStyle:{fontFamily:fonts.bold,fontSize:12},tabBarStyle:{backgroundColor:'#fff',borderTopColor:colors.border,height:76+insets.bottom,paddingTop:10,paddingBottom:Math.max(12,insets.bottom),direction:rtl?'rtl':'ltr'},tabBarItemStyle:{minHeight:52}}}><Tabs.Screen name="index" options={{title:t('explore'),tabBarIcon:({color})=><Icon name="search" color={color}/>}}/><Tabs.Screen name="saved" options={{title:t('saved'),tabBarIcon:({color})=><Icon name="saved" color={color}/>}}/><Tabs.Screen name="account" options={{title:t('account'),tabBarIcon:({color})=><Icon name="account" color={color}/>}}/></Tabs>;}
