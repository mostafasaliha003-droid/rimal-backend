import React from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Circle, Ellipse, Line, Path, Polygon, Polyline, Rect } from 'react-native-svg';
import { useLanguage } from '../i18n';
import { color as roles } from '../theme';
import { directionalIcons, iconData, type IconName } from './iconData';

export type { IconName } from './iconData';

const elements: Record<string, React.ComponentType<Record<string, unknown>>> = {
  path: Path, circle: Circle, rect: Rect, line: Line, polyline: Polyline, polygon: Polygon, ellipse: Ellipse,
} as Record<string, React.ComponentType<Record<string, unknown>>>;

/**
 * 24x24 stroke icon. Colour flows through `currentColor`, so one `color` prop tints
 * every stroke and fill. Icons are decorative: the control that owns them supplies
 * the accessible name. Only direction-bearing icons mirror in right-to-left layouts.
 */
export function Icon({ name, color, size = 24, strokeWidth, filled = false }: {
  name: IconName; color?: ColorValue | null; size?: number; strokeWidth?: number; filled?: boolean;
}) {
  const { rtl } = useLanguage();
  // Small icons get a slightly heavier stroke so they keep the same optical weight.
  const stroke = strokeWidth ?? (size <= 18 ? 2 : 1.75);
  const mirror = rtl && directionalIcons.has(name);
  return <Svg width={size} height={size} viewBox="0 0 24 24" color={(color || roles.textBrand) as string}
    fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round"
    accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden
    style={{ flexShrink: 0, ...(mirror ? { transform: [{ scaleX: -1 }] } : {}) }}>
    {iconData[name].map(([tag, attributes], index) => {
      const Element = elements[tag];
      return <Element key={index} {...attributes}/>;
    })}
  </Svg>;
}
