import { StyleSheet } from 'react-native';

export const colors = {
  primary: '#2D173A', canvas: '#FAF8F4', lilac: '#C9B7F5', pistachio: '#DFE8C7',
  navy: '#2D173A', blue: '#533361', blueStrong: '#46244F', red: '#A12B39', orange: '#805A16',
  ink: '#201626', background: '#FAF8F4', surface: '#FFFFFF', muted: '#675E6B', border: '#E8E1E9',
  softBlue: '#F0EAF9', softGold: '#FBF3E4', goldInk: '#805A16', dangerSoft: '#FBECEF', success: '#23674B',
};
export const fonts = { regular: 'PlexArabicRegular', medium: 'PlexArabicMedium', bold: 'PlexArabicBold' };
const latinFonts: Record<string, string> = {
  [fonts.regular]: 'ManropeRegular', [fonts.medium]: 'ManropeMedium', [fonts.bold]: 'ManropeBold',
};
export function localizedFont(language: string, family = fonts.regular) {
  return language === 'ar' ? family : latinFonts[family] || family;
}
export const tokens = {
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 },
  radius: { sm: 14, md: 14, lg: 22, pill: 999 },
  control: { minHeight: 48 }, layout: { maxWidth: 880 },
};
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, direction: 'ltr' },
  page: { padding: 20, gap: 18, paddingBottom: 36, width: '100%', maxWidth: 880, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colors.border, gap: 14 },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 38, color: colors.navy },
  heading: { fontFamily: fonts.bold, fontSize: 21, lineHeight: 30, color: colors.navy },
  text: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 25, color: colors.ink },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.muted },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.navy },
  input: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 15, paddingVertical: 12, fontFamily: fonts.medium, fontSize: 17, color: colors.ink },
  rule: { height: 1, backgroundColor: colors.border },
  shadow: { shadowColor: colors.navy, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 },
});
