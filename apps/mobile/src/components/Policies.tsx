import React from 'react';
import { View } from 'react-native';
import { useLanguage } from '../i18n';
import { colors, fonts, ui } from '../theme';
import { Txt } from './Primitives';
import { hotelPolicyCopy, hotelPolicySections, hotelExtraInformation } from './hotelPoliciesData';

// Pure certification formatter copied unchanged from the web app. Only the
// presentation is native; no HTML renderer or supplier-content WebView.
export default function Policies({ source, extra }: { source: Record<string, unknown>; extra: string | null }) {
  const { language, rtl } = useLanguage();
  const hotel = { metapolicy_struct: source, metapolicy_extra_info: extra || '' };
  const sections = hotelPolicySections(hotel, language);
  const additional = hotelExtraInformation(hotel);
  const copy = hotelPolicyCopy(language);
  if (!sections.length && !additional) return null;
  return <View style={{ gap: 18 }}><Txt accessibilityRole="header" kind="heading">{copy.title}</Txt>{sections.map(section => <View key={section.key} style={{ gap: 12 }}><Txt accessibilityRole="header" kind="heading" style={{ fontSize: 18 }}>{section.title}</Txt>{section.entries.map((entry, index) => <View key={index} style={ui.card}>{entry.rows.map((row, rowIndex) => <View key={rowIndex} style={{ gap: 4 }}>{row.label && <Txt kind="small">{row.label}</Txt>}<Txt style={{ fontFamily: row.emphasis ? fonts.bold : fonts.medium, color: row.emphasis ? colors.navy : colors.ink }}>{row.segments ? row.segments.map(segment => segment.direction === 'ltr' && rtl ? `\u2066${segment.text}\u2069` : segment.text).join(row.separator) : row.value}</Txt></View>)}</View>)}</View>)}{additional && <View style={[ui.card, { backgroundColor: colors.softBlue }]}><Txt kind="label">{copy.extra}</Txt><Txt>{additional}</Txt></View>}</View>;
}
