import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

/**
 * Light physical feedback for choices the traveler makes (a date, a rate, a filter, saving a
 * stay) and for a confirmed booking. Android uses the system haptics engine, which follows the
 * device's touch-feedback setting and needs no vibration permission. Web does nothing.
 * Feedback never blocks or fails the action it accompanies.
 */
export type HapticKind = 'select' | 'toggleOn' | 'toggleOff' | 'confirm';

const android: Record<HapticKind, Haptics.AndroidHaptics> = {
  select: Haptics.AndroidHaptics.Segment_Tick,
  toggleOn: Haptics.AndroidHaptics.Toggle_On,
  toggleOff: Haptics.AndroidHaptics.Toggle_Off,
  confirm: Haptics.AndroidHaptics.Confirm,
};

export function haptic(kind: HapticKind = 'select') {
  try {
    if (Platform.OS === 'android') void Haptics.performAndroidHapticsAsync(android[kind]).catch(() => undefined);
    else if (Platform.OS === 'ios') {
      const done = kind === 'confirm' ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.selectionAsync();
      void done.catch(() => undefined);
    }
  } catch { /* feedback is optional */ }
}
