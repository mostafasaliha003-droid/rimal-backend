import React, { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { useLanguage } from '../i18n';
import { authSession } from '../api';
import type { BookingHistoryItem } from '../api/bookings';
import { canDownloadVoucher, fetchVoucher } from '../api/voucher';
import { Button, Txt } from './Primitives';

export default function VoucherButton({ booking, onDark = false, compact = false }: { booking: BookingHistoryItem; onDark?: boolean; compact?: boolean }) {
  const { language } = useLanguage();
  const pending = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle');
  useEffect(() => () => { pending.current?.abort(); }, []);
  if (!canDownloadVoucher(booking)) return null;
  const ar = language === 'ar';
  const download = async () => {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const revision = authSession.getRevision();
    const active = () => !controller.signal.aborted && authSession.getRevision() === revision;
    const timeout = setTimeout(() => controller.abort(), 60000);
    setStatus('busy');
    try {
      const token = await authSession.getToken();
      if (!token || !active()) throw Error();
      const pdf = await fetchVoucher(booking, language, token, controller.signal);
      if (!active()) throw Error();
      clearTimeout(timeout);
      const filename = 'pillow-stays-voucher-' + booking.reference.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) + '.pdf';
      if (Platform.OS === 'web') {
        const objectUrl = URL.createObjectURL(new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }));
        try {
          const anchor = document.createElement('a');
          anchor.href = objectUrl; anchor.download = filename;
          document.body.appendChild(anchor); anchor.click(); anchor.remove();
        } finally { setTimeout(() => URL.revokeObjectURL(objectUrl), 30000); }
      } else {
        const { Directory } = await import('expo-file-system');
        const directory = await Directory.pickDirectoryAsync();
        if (!active()) throw Error();
        const output = directory.createFile(filename, 'application/pdf');
        try { output.write(pdf); } catch (error) { if (output.exists) output.delete(); throw error; }
      }
      if (active()) setStatus('saved');
    } catch { if (authSession.getRevision() === revision) setStatus('error'); }
    finally { clearTimeout(timeout); pending.current = null; }
  };
  const tone = onDark ? 'onDark' : undefined;
  return <View style={{ gap: 4, alignSelf: compact ? 'flex-start' : undefined }}><Button variant={compact ? 'tonal' : 'secondary'} compact={compact} icon="download" title={ar ? (compact ? 'القسيمة' : 'تنزيل القسيمة') : (compact ? 'Voucher' : 'Download voucher')}
    label={(ar ? 'تنزيل قسيمة الحجز · ' : 'Download voucher · ') + booking.reference}
    busy={status === 'busy'} onPress={() => void download()}/>
    {status === 'error' && <Txt kind="small" tone={tone ?? 'danger'} accessibilityRole="alert">{ar ? 'لم تُحفظ قسيمة الحجز. تحقق من الاتصال وحاول مجدداً.' : 'The voucher was not saved. Check your connection and try again.'}</Txt>}
    {status === 'saved' && <Txt kind="small" tone={tone ?? 'success'} accessibilityLiveRegion="polite">{ar ? 'تم تنزيل قسيمة الحجز.' : 'Voucher downloaded.'}</Txt>}
  </View>;
}
