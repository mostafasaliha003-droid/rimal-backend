import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, elevation, layout, radius, space } from '../theme';
import { Icon, type IconName } from './Icon';
import { Row, Txt } from './Primitives';
import { useReducedMotion } from './motion';

interface ToastInput { message: string; icon?: IconName; action?: { label: string; onPress: () => void } }
type ToastState = ToastInput & { id: number };
const Context = createContext<(toast: ToastInput) => void>(() => {});

/** Brief confirmation of an action the traveler just took. Sits under the header so it never covers sticky booking buttons. */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const reduced = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));
  const sequence = useRef(0);
  const show = useCallback((input: ToastInput) => {
    sequence.current += 1;
    setToast({ ...input, id: sequence.current });
    AccessibilityInfo.announceForAccessibility(input.message);
  }, []);
  useEffect(() => {
    if (!toast) return;
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: reduced ? 1 : 200, useNativeDriver: Platform.OS !== 'web' }).start();
    const timer = setTimeout(() => {
      Animated.timing(progress, { toValue: 0, duration: reduced ? 1 : 160, useNativeDriver: Platform.OS !== 'web' })
        .start(() => setToast(current => current?.id === toast.id ? null : current));
    }, toast.action ? 5000 : 3200);
    return () => clearTimeout(timer);
  }, [toast, progress, reduced]);
  return <Context.Provider value={show}>
    {children}
    {toast && <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 64 }]}>
      <Animated.View testID="toast" accessibilityLiveRegion="polite" aria-live="polite" style={[styles.toast, elevation.overlay, {
        opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [reduced ? 0 : -12, 0] }) }] }]}>
        <Row style={{ gap: space.sm }}>
          <Icon name={toast.icon || 'checkCircle'} size={20} color={color.textOnDark}/>
          <Txt kind="label" style={{ color: color.textOnDark, flex: 1 }}>{toast.message}</Txt>
          {toast.action && <Pressable accessibilityRole="button" onPress={() => { toast.action?.onPress(); setToast(null); }} style={styles.action}>
            <Txt kind="label" style={{ color: color.textOnDarkMuted }}>{toast.action.label}</Txt>
          </Pressable>}
        </Row>
      </Animated.View>
    </View>}
  </Context.Provider>;
}

export const useToast = () => useContext(Context);

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: space.lg, zIndex: 1000 },
  toast: { width: '100%', maxWidth: layout.maxForm, backgroundColor: color.bgBrand, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md, minHeight: 48, justifyContent: 'center' },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: space.sm },
});
