import { StyleSheet } from 'react-native';

export const colors = {
  navy: '#102A43', blue: '#0F8FA3', blueStrong: '#0B6573', red: '#8B0000', orange: '#E8752D',
  ink: '#12212F', background: '#F7F9FC', surface: '#FFFFFF', muted: '#526477', border: '#E2E8F0',
  softBlue: '#EAF5F7', softGold: '#FFF5E7', goldInk: '#795018', dangerSoft: '#FFF1F1', success: '#176947',
};
export const fonts = { regular: 'Tajawal_400Regular', medium: 'Tajawal_500Medium', bold: 'Tajawal_700Bold' };
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, direction: 'ltr' },
  page: { padding: 20, gap: 18, paddingBottom: 36, width: '100%', maxWidth: 880, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  card: { backgroundColor: colors.surface, borderRadius: 22, padding: 20, borderWidth: 1, borderColor: colors.border, gap: 14 },
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 38, color: colors.navy },
  heading: { fontFamily: fonts.bold, fontSize: 21, lineHeight: 30, color: colors.navy },
  text: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 25, color: colors.ink },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, color: colors.muted },
  label: { fontFamily: fonts.bold, fontSize: 14, lineHeight: 22, color: colors.navy },
  input: { minHeight: 54, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, paddingHorizontal: 15, paddingVertical: 12, fontFamily: fonts.medium, fontSize: 17, color: colors.ink },
  rule: { height: 1, backgroundColor: colors.border },
  shadow: { shadowColor: colors.navy, shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.06, shadowRadius: 20, elevation: 2 },
});
