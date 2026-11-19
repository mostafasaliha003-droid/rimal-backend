import { useEffect, useState } from 'react';
import { AccessibilityInfo, useWindowDimensions } from 'react-native';
import { gutterFor, windowClass } from '../theme';

/** Follows the system "reduce motion" setting, including changes while the app is open. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active) setReduced(value); }).catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => setReduced(value));
    return () => { active = false; subscription?.remove(); };
  }, []);
  return reduced;
}

/** Window class, gutter and a font-scale-aware "narrow" flag for responsive layouts. */
export function useLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const size = windowClass(width);
  return { width, height, fontScale, size, gutter: gutterFor(width), wide: size !== 'compact',
    desktop: size === 'expanded' || size === 'large', narrow: width / Math.max(1, fontScale) < 360 };
}
