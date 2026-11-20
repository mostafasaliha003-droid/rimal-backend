import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Linking, Modal, Platform, View } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APP_ENV, endpoints } from '../api/config';
import { useLanguage } from '../i18n';
import { color, space } from '../theme';
import { Button, Txt } from './Primitives';
import { normalizeRelease, updateDecision, type AndroidRelease, type UpdateDecision } from './appUpdateModel';

const CHECK_EVERY_MS = 30 * 60_000;
const dismissedKey = `mkhadda.update.dismissed.${APP_ENV}`;
const installedVersionCode = Constants.expoConfig?.android?.versionCode ?? null;
const installedVersion = Constants.expoConfig?.version ?? '';

// Kept outside React so the check can run from app events without re-rendering callers.
let snapshot: { release: AndroidRelease | null; decision: UpdateDecision } = { release: null, decision: 'none' };
let lastCheck = 0;
const listeners = new Set<() => void>();
const publish = (next: typeof snapshot) => { snapshot = next; listeners.forEach(listener => listener()); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const read = () => snapshot;

async function checkForUpdate() {
  if (Platform.OS !== 'android' || Date.now() - lastCheck < CHECK_EVERY_MS) return;
  lastCheck = Date.now();
  // A plain timer: AbortSignal.timeout is not available on every Android JavaScript engine.
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoints(APP_ENV).api + '/app/version', {
      method: 'GET', credentials: 'omit', headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) return;
    const release = normalizeRelease(await response.json());
    const dismissed = Number(await AsyncStorage.getItem(dismissedKey).catch(() => null)) || null;
    publish({ release, decision: updateDecision(installedVersionCode, release, dismissed) });
  } catch { /* No answer is not a reason to interrupt the guest. */ }
  finally { clearTimeout(timer); }
}

/**
 * Tells the guest when a newer Android build is available. Builds below the server's
 * minimum see a prompt that cannot be dismissed; otherwise "Later" hides that version.
 */
export default function AppUpdatePrompt() {
  const { language } = useLanguage(); const ar = language === 'ar';
  const { release, decision } = useSyncExternalStore(subscribe, read, read);
  const [openError, setOpenError] = useState(false);
  useEffect(() => {
    void checkForUpdate();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') void checkForUpdate(); });
    return () => subscription.remove();
  }, []);

  if (decision === 'none' || !release) return null;
  const required = decision === 'required';
  const later = () => {
    publish({ release, decision: 'none' });
    void AsyncStorage.setItem(dismissedKey, String(release.latestVersionCode)).catch(() => {});
  };
  const update = () => {
    setOpenError(false);
    // The system browser downloads the APK; Android then offers to install it.
    void Linking.openURL(release.downloadUrl).catch(() => setOpenError(true));
  };
  return <Modal transparent animationType="fade" visible onRequestClose={required ? () => {} : later}>
    <View style={{ flex: 1, backgroundColor: 'rgba(32,22,38,0.55)', justifyContent: 'center', padding: space.lg }}>
      <View accessibilityViewIsModal style={{ backgroundColor: color.bgSurface, borderRadius: 22, padding: space.lg, gap: space.md }}>
        <Txt kind="heading" accessibilityRole="header">{required
          ? (ar ? 'تحديث مطلوب' : 'Update required')
          : (ar ? 'يتوفر تحديث جديد' : 'A new version is available')}</Txt>
        <Txt>{required
          ? (ar ? `هذه النسخة لم تعد مدعومة. حمّل الإصدار ${release.latestVersion} لتكمل استخدام التطبيق.` : `This version is no longer supported. Download version ${release.latestVersion} to keep using the app.`)
          : (ar ? `الإصدار ${release.latestVersion} متاح، وفيه تحسينات وإصلاحات.` : `Version ${release.latestVersion} is available with improvements and fixes.`)}</Txt>
        <Txt kind="caption">{ar ? `نسختك الحالية: ${installedVersion}. بعد التحميل افتح الملف واختر "تثبيت"؛ يبقى حسابك وبياناتك.`
          : `Your version: ${installedVersion}. After downloading, open the file and choose Install; your account and data stay.`}</Txt>
        {openError && <Txt kind="small" accessibilityRole="alert" tone="danger">{ar ? 'تعذّر فتح رابط التحميل.' : 'Could not open the download link.'}</Txt>}
        <Button title={ar ? 'تحديث الآن' : 'Update now'} icon="download" onPress={update}/>
        {!required && <Button title={ar ? 'لاحقاً' : 'Later'} variant="quiet" onPress={later}/>}
      </View>
    </View>
  </Modal>;
}
