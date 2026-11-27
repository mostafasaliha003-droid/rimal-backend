import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { color, latinFonts, radius } from '../theme';
import { validMarkers } from './mapHtml';
import type { StaysMapProps } from './StaysMap';

const EDGE = { top: 56, right: 40, bottom: 40, left: 40 };
const SINGLE_DELTA = 0.012;

/**
 * Hotels on Apple Maps, the map an iPhone user already knows: native scrolling and zoom, no web
 * page to download, and it follows the phone's light or dark appearance. The price pins match the
 * web map's. Android and the web keep the MapLibre page (StaysMap.tsx, StaysMap.web.tsx), since
 * Google's native map needs a billed key.
 */
export default function StaysMap({ markers, selected = null, onSelect, height, interactive = true, label, testID }: StaysMapProps) {
  const map = useRef<MapView>(null);
  const points = useMemo(() => validMarkers(markers), [markers]);
  const first = points[0];
  const fit = () => {
    if (points.length > 1) map.current?.fitToCoordinates(points.map(({ latitude, longitude }) => ({ latitude, longitude })), { edgePadding: EDGE, animated: false });
  };
  useEffect(() => {
    const target = points.find(point => point.id === selected);
    if (target && interactive) map.current?.animateCamera({ center: { latitude: target.latitude, longitude: target.longitude } }, { duration: 400 });
  }, [selected, points, interactive]);
  return <View testID={testID} accessibilityLabel={label} style={[styles.frame, { height }]}>
    <MapView ref={map} style={StyleSheet.absoluteFill} onMapReady={fit} onLayout={fit}
      initialRegion={first ? { latitude: first.latitude, longitude: first.longitude, latitudeDelta: SINGLE_DELTA, longitudeDelta: SINGLE_DELTA }
        : { latitude: 25.2, longitude: 55.27, latitudeDelta: 0.3, longitudeDelta: 0.3 }}
      scrollEnabled={interactive} zoomEnabled={interactive} rotateEnabled={false} pitchEnabled={false}
      pointerEvents={interactive ? 'auto' : 'none'} showsCompass={false} showsScale={false} toolbarEnabled={false}>
      {points.map(point => {
        const on = point.id === selected;
        return <Marker key={point.id} identifier={String(point.id)} coordinate={{ latitude: point.latitude, longitude: point.longitude }}
          anchor={{ x: 0.5, y: 1 }} zIndex={on ? 2 : 1} accessibilityLabel={`${point.name} ${point.label}`}
          onPress={() => onSelect?.(point.id)}>
          <View style={[styles.pin, on && styles.pinOn]}>
            <Text style={[styles.pinText, on && styles.pinTextOn]} numberOfLines={1}>{point.label}</Text>
          </View>
        </Marker>;
      })}
    </MapView>
  </View>;
}

const styles = StyleSheet.create({
  frame: { width: '100%', borderRadius: radius.lg, overflow: 'hidden', backgroundColor: color.bgField },
  pin: { borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: color.actionPrimary, marginBottom: 4,
    shadowColor: '#201626', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.28, shadowRadius: 4 },
  pinOn: { backgroundColor: color.bgSurface, borderWidth: 2, borderColor: color.actionPrimary, transform: [{ scale: 1.12 }] },
  pinText: { color: color.onActionPrimary, fontFamily: latinFonts.bold, fontSize: 13, lineHeight: 16, writingDirection: 'ltr' },
  pinTextOn: { color: color.textBrand },
});
