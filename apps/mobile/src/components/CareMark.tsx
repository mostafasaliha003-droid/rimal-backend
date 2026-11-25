import React from 'react';
import Svg, { Circle, Defs, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

/** The Mkhadda care mark: a soft pillow-shaped speech bubble with three dots, on a glowing plum tile. */
export default function CareMark({ size = 56 }: { size?: number }) {
  return <Svg width={size} height={size} viewBox="0 0 56 56" accessible={false}>
    <Defs>
      <RadialGradient id="careGlow" cx="30%" cy="25%" r="80%">
        <Stop offset="0" stopColor="#8E6BC0"/><Stop offset="0.55" stopColor="#513069"/><Stop offset="1" stopColor="#2D173A"/>
      </RadialGradient>
    </Defs>
    <Rect x="0" y="0" width="56" height="56" rx="18" fill="url(#careGlow)"/>
    {/* A pillow: four soft corners, with a speech tail. */}
    <Path d="M14 18c4-3 24-3 28 0 2.5 4 2.5 14 0 18-3 2-9 2.6-14 2.4l-6 5.2c-.8.7-2-.1-1.7-1.1l1.3-4.4c-3.4-.4-6.2-1-7.6-2.1-2.5-4-2.5-14 0-18Z" fill="#FFFFFF"/>
    <Circle cx="21" cy="27" r="2.3" fill="#654288"/><Circle cx="28" cy="27" r="2.3" fill="#654288"/><Circle cx="35" cy="27" r="2.3" fill="#F2B48C"/>
  </Svg>;
}
