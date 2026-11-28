import { Appearance, Easing, Platform, StyleSheet } from 'react-native';

/*
 * Pillow Stays design tokens.
 *
 * The palette starts from the approved symbol: plum (#2D173A) and cream (#FAF8F4),
 * with the pillow-kit accents (lavender, pistachio, apricot). Components use the
 * semantic `color` roles, never raw palette values, so a role can change in one place.
 * Contrast ratios are recorded in release/design-system-0.26.md (WCAG 2.2 AA).
 */
export const palette = {
  plum900: '#201626', plum800: '#2D173A', plum700: '#46244F', plum600: '#513069', plum500: '#654288',
  lavender300: '#C9B7F5', lavender100: '#F3EBFD', lavender50: '#F9F6FE',
  cream: '#FAF8F4', sand100: '#F3EFE9', white: '#FFFFFF',
  neutral600: '#675E6B', neutral400: '#8E8392', neutral200: '#E8E1E9',
  pistachio300: '#DFE8C7', pistachio100: '#EFF4E6', leaf700: '#375333', green700: '#23674B',
  gold700: '#805A16', gold200: '#EBD9B4', gold100: '#FBF3E4',
  apricot200: '#F9DDC9', apricot100: '#FCEEE4', apricot800: '#774324',
  red700: '#A12B39', red200: '#F0C9D0', red100: '#FBECEF',
} as const;

const lightColor = {
  // Actions: one filled primary action per view; everything else is secondary or quiet.
  actionPrimary: palette.plum800, actionPrimaryPressed: palette.plum700, actionPrimaryHover: '#3A2149',
  onActionPrimary: palette.white,
  actionSecondary: palette.white, actionSecondaryPressed: palette.lavender100, onActionSecondary: palette.plum800,
  interactive: palette.plum500, interactiveStrong: palette.plum600, focusRing: palette.plum500,
  // Text
  textPrimary: palette.plum900, textBrand: palette.plum800, textSecondary: palette.neutral600,
  textLink: palette.plum600, textOnDark: palette.white, textOnDarkMuted: palette.lavender300,
  // Surfaces
  bgCanvas: palette.cream, bgSurface: palette.white, bgSubtle: palette.sand100, bgSelected: palette.lavender100,
  bgBrand: palette.plum800, bgAccent: palette.apricot100, bgMuted: palette.lavender50,
  scrim: 'rgba(32,22,38,0.48)', photoPlaceholder: palette.lavender100,
  // Filled controls: inputs, chips and secondary buttons sit on a warm fill instead of a grey outline.
  // The fill (with its label) marks the control; the outline appears only for focus and errors.
  bgField: '#F2EEE8', bgFieldPressed: '#E9E3DA', bgFieldFocus: palette.white,
  // Borders: decorative separators are quiet; control boundaries keep 3:1 contrast.
  border: palette.neutral200, borderControl: palette.neutral400, borderSelected: palette.plum500,
  // Cards sit on the cream canvas with a hairline edge and a soft shadow instead of a grey outline.
  borderCard: 'rgba(45,23,58,0.08)',
  // Status (text on its own background is at least 4.5:1)
  success: palette.green700, successBg: palette.pistachio100, successBorder: palette.pistachio300,
  warning: palette.gold700, warningBg: palette.gold100, warningBorder: palette.gold200,
  danger: palette.red700, dangerBg: palette.red100, dangerBorder: palette.red200,
  info: palette.plum600, infoBg: palette.lavender100, infoBorder: palette.lavender300,
  accent: palette.apricot800, accentBg: palette.apricot100, accentBorder: palette.apricot200,
  // Commerce
  price: palette.plum900, rating: palette.gold700,
  // Foreground on an interactive fill (checkboxes, the selected tab, send): white by day, ink by night.
  onInteractive: palette.white,
  // Pressed and hover fills of the quieter controls.
  secondaryHover: '#EEE9E2', tonalPressed: '#E7DBFA', tonalHover: '#EEE4FC', chipActivePressed: '#EADFFB',
  dangerPressed: '#8A2230', dangerHover: '#952634',
  // A round control sitting on a photograph (save, gallery), and the backdrop behind a full-screen photo.
  onPhotoChip: 'rgba(255,255,255,0.95)', photoBackdrop: '#120C16',
  // The "Tabby" style mint tag at checkout.
  mint: '#04503C', mintBg: 'rgba(62,237,191,0.22)',
};

/*
 * Night: the same roles on a deep plum ground. Lavender replaces plum for actions and links so they
 * keep 4.5:1 text contrast; the brand panels (bgBrand) stay plum with white text, as by day.
 */
const darkColor: Record<keyof typeof lightColor, string> = {
  actionPrimary: '#D9C8FA', actionPrimaryPressed: '#C9B7F5', actionPrimaryHover: '#E3D6FB',
  onActionPrimary: '#1A1220',
  actionSecondary: '#2A2230', actionSecondaryPressed: '#352A3F', onActionSecondary: '#EDE4FA',
  interactive: '#C9B7F5', interactiveStrong: '#DCCDFB', focusRing: '#C9B7F5',
  textPrimary: '#F4EFF6', textBrand: '#EDE4FA', textSecondary: '#B7ACBD',
  textLink: '#D2C0FA', textOnDark: palette.white, textOnDarkMuted: palette.lavender300,
  bgCanvas: '#0E0A11', bgSurface: '#1F1824', bgSubtle: '#262029', bgSelected: '#33284A',
  bgBrand: '#3A2149', bgAccent: '#33241B', bgMuted: '#1B161F',
  scrim: 'rgba(0,0,0,0.62)', photoPlaceholder: '#2A2230',
  bgField: '#2A2230', bgFieldPressed: '#352C3D', bgFieldFocus: '#1F1824',
  border: '#3A3140', borderControl: '#857A8B', borderSelected: '#C9B7F5',
  borderCard: 'rgba(255,255,255,0.11)',
  success: '#8FD1AD', successBg: '#16291F', successBorder: '#2B4A39',
  warning: '#E8C27A', warningBg: '#2E2412', warningBorder: '#4D3C1C',
  danger: '#F2A3AE', dangerBg: '#3A1A20', dangerBorder: '#5C2A33',
  info: '#D2C0FA', infoBg: '#2A2140', infoBorder: '#4A3A6B',
  accent: '#F2B98F', accentBg: '#35241A', accentBorder: '#5A3B28',
  price: '#F4EFF6', rating: '#E8C27A',
  onInteractive: '#1A1220',
  secondaryHover: '#30273A', tonalPressed: '#3D3058', tonalHover: '#382C50', chipActivePressed: '#3D3058',
  dangerPressed: '#E68D9A', dangerHover: '#F5B3BC',
  onPhotoChip: 'rgba(31,24,36,0.92)', photoBackdrop: '#120C16',
  mint: '#7FE8C8', mintBg: 'rgba(62,237,191,0.16)',
};

/**
 * Light or dark, read once at launch from the phone's appearance. Styles are built when their
 * modules load, so the app keeps this scheme until it is next opened; _layout pins the native
 * views (keyboard, map, alerts) to the same scheme so nothing mixes the two.
 */
export type ColorScheme = 'light' | 'dark';
export const colorScheme: ColorScheme = Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
export const color: Readonly<Record<keyof typeof lightColor, string>> = colorScheme === 'dark' ? darkColor : lightColor;

/** 4-point spacing scale. */
export const space = { none: 0, xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48, huge: 64 } as const;
export const radius = { xs: 6, sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;
export const border = { hairline: StyleSheet.hairlineWidth, thin: 1, strong: 1.5, focus: 2 } as const;

/** Minimum touch target: 44pt on iOS (HIG), 48dp on Android (Material 3), 44px on web. */
export const touch = { min: Platform.select({ android: 48, default: 44 }) as number, comfortable: 48 } as const;

export const fonts = { regular: 'PlexArabicRegular', medium: 'PlexArabicMedium', bold: 'PlexArabicBold' } as const;
export const latinFonts = { regular: 'ManropeRegular', medium: 'ManropeMedium', bold: 'ManropeBold' } as const;
type Weight = keyof typeof fonts;

/**
 * Type scale. Arabic (IBM Plex Sans Arabic) needs taller lines than Latin (Manrope)
 * for its ascenders, descenders and diacritics, so each step carries both.
 */
export const typeScale = {
  display: { fontSize: 30, lineHeight: 38, lineHeightAr: 44, weight: 'bold' },
  title: { fontSize: 24, lineHeight: 32, lineHeightAr: 36, weight: 'bold' },
  heading: { fontSize: 20, lineHeight: 28, lineHeightAr: 32, weight: 'bold' },
  subheading: { fontSize: 17, lineHeight: 24, lineHeightAr: 28, weight: 'bold' },
  body: { fontSize: 16, lineHeight: 24, lineHeightAr: 28, weight: 'regular' },
  bodyStrong: { fontSize: 16, lineHeight: 24, lineHeightAr: 28, weight: 'medium' },
  label: { fontSize: 14, lineHeight: 20, lineHeightAr: 24, weight: 'medium' },
  small: { fontSize: 14, lineHeight: 20, lineHeightAr: 24, weight: 'regular' },
  caption: { fontSize: 13, lineHeight: 18, lineHeightAr: 20, weight: 'regular' },
  micro: { fontSize: 12, lineHeight: 16, lineHeightAr: 20, weight: 'medium' },
  price: { fontSize: 22, lineHeight: 28, lineHeightAr: 32, weight: 'bold' },
  priceLarge: { fontSize: 28, lineHeight: 36, lineHeightAr: 40, weight: 'bold' },
} as const satisfies Record<string, { fontSize: number; lineHeight: number; lineHeightAr: number; weight: Weight }>;
export type TypeVariant = keyof typeof typeScale;

export function localizedFont(language: string, family: string = fonts.regular) {
  if (language === 'ar') return family;
  const weight = (Object.keys(fonts) as Weight[]).find(key => fonts[key] === family);
  return weight ? latinFonts[weight] : family;
}

export function typeStyle(variant: TypeVariant, language: string) {
  const step = typeScale[variant];
  return { fontFamily: localizedFont(language, fonts[step.weight]), fontSize: step.fontSize,
    lineHeight: language === 'ar' ? step.lineHeightAr : step.lineHeight };
}

// By night a plum shadow disappears into the ground: raised layers cast a deeper black one instead.
const night = colorScheme === 'dark';
const shadowInk = night ? '#000000' : palette.plum900;
export const elevation = StyleSheet.create({
  card: { shadowColor: shadowInk, shadowOffset: { width: 0, height: 1 }, shadowOpacity: night ? 0.3 : 0.06, shadowRadius: 3, elevation: 1 },
  raised: { shadowColor: shadowInk, shadowOffset: { width: 0, height: 6 }, shadowOpacity: night ? 0.4 : 0.08, shadowRadius: 16, elevation: 4 },
  overlay: { shadowColor: shadowInk, shadowOffset: { width: 0, height: 16 }, shadowOpacity: night ? 0.55 : 0.16, shadowRadius: 32, elevation: 12 },
});

/** Material 3 window classes: compact < 600 <= medium < 840 <= expanded < 1200 <= large. */
export const layout = {
  breakpoints: { medium: 600, expanded: 840, large: 1200 },
  maxContent: 1200, maxReading: 720, maxForm: 560, maxSheet: 640,
  gutter: { compact: 16, medium: 24, expanded: 32 },
} as const;
export type WindowClass = 'compact' | 'medium' | 'expanded' | 'large';
export function windowClass(width: number): WindowClass {
  return width >= layout.breakpoints.large ? 'large' : width >= layout.breakpoints.expanded ? 'expanded'
    : width >= layout.breakpoints.medium ? 'medium' : 'compact';
}
export function gutterFor(width: number) {
  const size = windowClass(width);
  return size === 'compact' ? (width < 360 ? space.md : layout.gutter.compact) : size === 'medium' ? layout.gutter.medium : layout.gutter.expanded;
}

/** Short, purposeful motion. Every animation also honours the reduce-motion setting. */
export const motion = {
  fast: 120, base: 200, slow: 320,
  standard: Easing.bezier(0.2, 0, 0, 1), emphasized: Easing.bezier(0.3, 0, 0, 1), exit: Easing.bezier(0.3, 0, 1, 1),
} as const;

/*
 * Legacy aliases. Older components still read these names; each one now points at
 * a semantic role so the whole app shares one palette while screens migrate.
 */
export const colors = {
  primary: color.actionPrimary, canvas: color.bgCanvas, lilac: palette.lavender300, pistachio: palette.pistachio300,
  navy: color.textBrand, blue: palette.plum700, blueStrong: color.interactiveStrong, red: color.danger, orange: color.warning,
  ink: color.textPrimary, background: color.bgCanvas, surface: color.bgSurface, muted: color.textSecondary, border: color.border,
  softBlue: color.bgSelected, softGold: color.warningBg, goldInk: color.warning, dangerSoft: color.dangerBg, success: color.success,
  grape: color.interactive, violetInk: color.info, lavenderMist: color.bgSelected, leafInk: palette.leaf700,
  pistachioMist: color.successBg, apricot: palette.apricot200, apricotInk: palette.apricot800,
};
export const tokens = {
  space: { xs: space.xs, sm: space.sm, md: space.md, lg: space.lg, xl: space.xl, xxl: space.xxl },
  radius: { sm: radius.sm, md: radius.md, lg: radius.lg, pill: radius.pill },
  control: { minHeight: touch.min }, layout: { maxWidth: layout.maxContent },
};
export const ui = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bgCanvas, direction: 'ltr' },
  page: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl, width: '100%', maxWidth: layout.maxReading + 160, alignSelf: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  card: { backgroundColor: color.bgSurface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: color.borderCard, gap: space.md, ...elevation.card },
  title: { fontFamily: fonts.bold, fontSize: typeScale.title.fontSize, lineHeight: typeScale.title.lineHeightAr, color: color.textBrand },
  heading: { fontFamily: fonts.bold, fontSize: typeScale.heading.fontSize, lineHeight: typeScale.heading.lineHeightAr, color: color.textBrand },
  text: { fontFamily: fonts.regular, fontSize: typeScale.body.fontSize, lineHeight: typeScale.body.lineHeightAr, color: color.textPrimary },
  small: { fontFamily: fonts.regular, fontSize: typeScale.small.fontSize, lineHeight: typeScale.small.lineHeightAr, color: color.textSecondary },
  label: { fontFamily: fonts.medium, fontSize: typeScale.label.fontSize, lineHeight: typeScale.label.lineHeightAr, color: color.textBrand },
  input: { minHeight: 52, borderRadius: radius.md, borderWidth: 1.5, borderColor: 'transparent', backgroundColor: color.bgField,
    paddingHorizontal: space.md, paddingVertical: space.md, fontFamily: fonts.medium, fontSize: 16, color: color.textPrimary },
  rule: { height: 1, backgroundColor: color.border },
  shadow: elevation.raised,
});
