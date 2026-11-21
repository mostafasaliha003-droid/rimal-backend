import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, ApiError, authSession, COUNTRY_CODES, websiteUrl } from '../api';
import type { DocumentKind, MemberCategory, MemberDetails, MemberStatus } from '../api/membership';
import { useLanguage } from '../i18n';
import { color, radius, space } from '../theme';
import { Button, Chip, DisclosureMark, Field, Icon, Notice, Row, Txt } from './Primitives';
import CountryPicker, { countryName } from './CountryPicker';
import { chooseMembershipDocument } from './membershipDocument';

const gulf = ['ae','sa','kw','qa','bh','om'];
const otherCountries = COUNTRY_CODES.filter(code => !gulf.includes(code));
const professions = { student: 'طالب', doctor: 'طبيب', engineer: 'مهندس', nurse: 'ممرض', teacher: 'مدرّس',
  lecturer: 'محاضر', professor: 'أستاذ جامعي', manager: 'مدير', supervisor: 'مشرف', administrative: 'إداري',
  investor: 'مستثمر', partner: 'شريك', accountant: 'محاسب', lawyer: 'محامٍ', other: 'أخرى' };
const labels: Record<DocumentKind, [string, string]> = { passport: ['جواز السفر', 'Passport'],
  eid_front: ['الهوية الإماراتية · الوجه الأمامي', 'Emirates ID · front'], eid_back: ['الهوية الإماراتية · الوجه الخلفي', 'Emirates ID · back'] };
const requiredDocs = (category: MemberCategory): DocumentKind[] => category === 'gcc_citizen' ? ['passport'] : ['eid_front','eid_back'];
type Step = 'eligibility' | 'documents' | 'review';
const stepLabels = { eligibility: ['الأهلية', 'Eligibility'], documents: ['الوثائق', 'Documents'], review: ['المراجعة', 'Review'] };

export default function MembershipApplication({ initial, finished }: { initial: MemberStatus; finished: () => void }) {
  const { language, rtl } = useLanguage();
  const ar = rtl, lang = ar ? 0 : 1;
  const [details, setDetails] = useState<MemberDetails>(initial.details || { category: 'gcc_citizen', nationality: '', profession: '', professionTitle: '' });
  const [docs, setDocs] = useState<DocumentKind[]>(initial.documents);
  const [step, setStep] = useState<Step>(initial.details ? 'documents' : 'eligibility');
  const [showCountry, setCountry] = useState(false), [showProfession, setProfession] = useState(false);
  const [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const needed = requiredDocs(details.category);
  const allUploaded = needed.every(kind => docs.includes(kind));
  const valid = (details.category === 'gcc_citizen' ? gulf.includes(details.nationality) :
    otherCountries.includes(details.nationality) && Object.hasOwn(professions, details.profession) && details.professionTitle.trim().length >= 2);
  const text = (a: string, e: string) => ar ? a : e;
  const run = async (work: (token: string, signal: AbortSignal) => Promise<void>) => {
    if (pending.current) return;
    const controller = new AbortController(), revision = authSession.getRevision();
    pending.current = controller; setBusy(true); setError('');
    try {
      const token = await authSession.getToken();
      if (!token || authSession.getRevision() !== revision || controller.signal.aborted) throw Error();
      await work(token, controller.signal);
    } catch (e) {
      if (!controller.signal.aborted && authSession.getRevision() === revision) setError(e instanceof ApiError && ['invalid_document_size', 'invalid_document_image', 'document_too_large'].includes(e.code) ?
        text('اختر صورة JPG أو PNG بحجم أقصاه 5 ميغابايت.', 'Choose a JPG or PNG up to 5 MB.') :
        text('تعذّر إتمام الخطوة. راجع طلبك ثم أعد المحاولة.', 'This step could not be completed. Check your application and try again.'));
    } finally { pending.current = null; if (!controller.signal.aborted) setBusy(false); }
  };
  const save = () => run(async (token, signal) => {
    await api.saveMembershipDetails(details, language, token, signal);
    const current = await api.getMembershipStatus(signal);
    if (!signal.aborted) { setDocs(current.documents); setStep('documents'); setConsent(false); }
  });
  const upload = (kind: DocumentKind) => run(async (token, signal) => {
    const file = await chooseMembershipDocument();
    if (!file || signal.aborted) return;
    await api.uploadMembershipDocument(kind, file, token, signal);
    const current = await api.getMembershipStatus(signal);
    if (!signal.aborted) { setDocs(current.documents); setConsent(false); }
  });
  const submit = () => run(async (token, signal) => {
    if (!allUploaded || !consent) return;
    await api.submitMembership(token, signal); if (!signal.aborted) finished();
  });
  const chooseCategory = (category: MemberCategory) => {
    if (category !== details.category) setDetails({ category, nationality: '', profession: '', professionTitle: '' });
  };
  const stepKeys = Object.keys(stepLabels) as Step[];
  const stepIndex = stepKeys.indexOf(step);
  const docRow = (kind: DocumentKind) => {
    const uploaded = docs.includes(kind);
    return <Row key={kind} style={[styles.docRow, uploaded && { borderColor: color.successBorder, backgroundColor: color.successBg }]}>
      <Icon name={uploaded ? 'checkCircle' : 'fileUp'} size={20} color={uploaded ? color.success : color.interactiveStrong}/>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt kind="label">{labels[kind][lang]}</Txt>
        <Txt kind="caption" tone={uploaded ? 'success' : 'secondary'}>{uploaded ? text('تم الرفع', 'Uploaded') : text('مطلوبة · JPG أو PNG حتى 5 ميغابايت', 'Required · JPG or PNG up to 5 MB')}</Txt>
      </View>
      <Button compact variant={uploaded ? 'quiet' : 'secondary'} disabled={busy} icon={uploaded ? 'refresh' : 'fileUp'}
        title={uploaded ? text('استبدال', 'Replace') : text('رفع', 'Upload')} label={labels[kind][lang] + ' · ' + (uploaded ? text('استبدال', 'Replace') : text('رفع', 'Upload'))}
        onPress={() => void upload(kind)}/>
    </Row>;
  };
  return <View style={{ gap: space.md }}>
    <Row style={{ gap: space.xs }} accessibilityRole="progressbar" accessibilityLabel={`${stepIndex + 1} / ${stepKeys.length} · ${stepLabels[step][lang]}`}>
      {stepKeys.map((key, i) => <View key={key} style={{ flex: 1, gap: space.xs }}>
        <View style={[styles.bar, i <= stepIndex && { backgroundColor: color.interactive }]}/>
        <Txt kind="caption" style={i === stepIndex ? { color: color.interactiveStrong } : undefined}>{i + 1} · {stepLabels[key][lang]}</Txt>
      </View>)}
    </Row>
    {step === 'eligibility' ? <>
      <View accessibilityRole="radiogroup" style={{ gap: space.sm }}>
        {(['gcc_citizen', 'uae_professional'] as const).map(category => {
          const selected = details.category === category;
          return <Pressable key={category} accessibilityRole="radio" aria-checked={selected} accessibilityState={{ checked: selected, disabled: busy }} disabled={busy}
            onPress={() => chooseCategory(category)} style={[styles.option, selected && styles.optionOn]}>
            <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
              <View style={[styles.radio, selected && { borderColor: color.interactive }]}>{selected && <View style={styles.dot}/>}</View>
              <View style={{ flex: 1, gap: space.xxs }}>
                <Txt kind="label">{category === 'gcc_citizen' ? text('مواطن خليجي', 'GCC citizen') : text('مهني مقيم في الإمارات', 'UAE resident professional')}</Txt>
                <Txt kind="caption">{category === 'gcc_citizen' ? text('تحتاج جواز السفر.', 'You will need your passport.') : text('تحتاج الهوية الإماراتية بوجهيها.', 'You will need both sides of your Emirates ID.')}</Txt>
              </View>
            </Row>
          </Pressable>;
        })}
      </View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => setCountry(true)} style={styles.select}>
        <Row style={{ gap: space.sm }}><Icon name="globe" size={18} color={color.textSecondary}/>
          <View style={{ flex: 1 }}><Txt kind="caption">{text('الجنسية', 'Nationality')}</Txt>
            <Txt kind="bodyStrong" tone={details.nationality ? 'primary' : 'secondary'}>{details.nationality ? countryName(details.nationality, language) : text('اختر الجنسية', 'Choose nationality')}</Txt></View>
          <Icon name="chevron" size={18} color={color.textSecondary}/></Row>
      </Pressable>
      {details.category === 'uae_professional' && <>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: showProfession }} aria-expanded={showProfession} disabled={busy}
          onPress={() => setProfession(!showProfession)} style={styles.select}>
          <Row style={{ gap: space.sm }}><Icon name="badgeCheck" size={18} color={color.textSecondary}/>
            <View style={{ flex: 1 }}><Txt kind="caption">{text('المهنة', 'Profession')}</Txt>
              <Txt kind="bodyStrong" tone={details.profession ? 'primary' : 'secondary'}>{details.profession ? (ar ? professions[details.profession as keyof typeof professions] : details.profession) : text('اختر المهنة', 'Choose profession')}</Txt></View>
            <DisclosureMark open={showProfession}/></Row>
        </Pressable>
        {showProfession && <Row style={{ flexWrap: 'wrap', gap: space.sm }}>{Object.entries(professions).map(([key, label]) =>
          <Chip key={key} role="radio" selected={details.profession === key} label={ar ? label : key} onPress={() => { setDetails({ ...details, profession: key }); setProfession(false); }}/>)}</Row>}
        <Field label={text('المسمى المهني كما في الهوية', 'Job title as printed on your ID')} maxLength={160}
          value={details.professionTitle} onChangeText={professionTitle => setDetails({ ...details, professionTitle })}/></>}
      <Button iconEnd="forward" title={text('متابعة إلى الوثائق', 'Continue to documents')} busy={busy} disabled={!valid} onPress={() => void save()}/>
    </> : step === 'documents' ? <>
      <Txt kind="small" tone="primary">{text('صوّر كل وثيقة كاملة وبإضاءة جيدة دون انعكاس.', 'Photograph each document in full, in good light and without glare.')}</Txt>
      {needed.map(docRow)}
      <Button iconEnd="forward" title={text('مراجعة الطلب', 'Review application')} disabled={busy || !allUploaded} onPress={() => setStep('review')}/>
      <Button variant="quiet" icon="back" title={text('تعديل بيانات الأهلية', 'Edit eligibility')} disabled={busy} onPress={() => setStep('eligibility')}/>
    </> : <>
      <View style={styles.summary}>
        <Txt kind="caption">{text('الجنسية', 'Nationality')}</Txt><Txt kind="bodyStrong">{countryName(details.nationality, language)}</Txt>
        {!!details.professionTitle && <><Txt kind="caption">{text('المسمى المهني', 'Job title')}</Txt><Txt kind="bodyStrong">{details.professionTitle}</Txt></>}
        {needed.map(kind => <Row key={kind} style={{ gap: space.xs }}><Icon name="checkCircle" size={16} color={color.success}/><Txt kind="small" tone="primary">{labels[kind][lang]}</Txt></Row>)}
      </View>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent, disabled: busy }} aria-checked={consent} disabled={busy}
        onPress={() => setConsent(!consent)} style={[styles.option, consent && styles.optionOn]}>
        <Row style={{ alignItems: 'flex-start', gap: space.md }}>
          <View style={[styles.box, consent && { backgroundColor: color.interactive, borderColor: color.interactive }]}>{consent && <Icon name="check" size={14} strokeWidth={3} color={color.textOnDark}/>}</View>
          <Txt kind="small" tone="primary" style={{ flex: 1 }}>{text('أؤكد صحة البيانات وأوافق على استخدام الوثائق لمراجعة أهليتي للعضوية.', 'I confirm my information is accurate and consent to use of my documents to review eligibility.')}</Txt>
        </Row>
      </Pressable>
      <Button compact variant="quiet" icon="external" title={text('سياسة الخصوصية', 'Privacy policy')}
        onPress={() => { void WebBrowser.openBrowserAsync(websiteUrl('/privacy')).catch(() => setError(text('تعذّر فتح السياسة', 'Could not open policy'))); }}/>
      <Button icon="check" title={text('إرسال طلب العضوية', 'Submit membership application')} disabled={!consent} busy={busy} onPress={() => void submit()}/>
      <Button variant="quiet" icon="back" title={text('مراجعة الوثائق', 'Back to documents')} disabled={busy} onPress={() => setStep('documents')}/>
    </>}
    {!!error && <Notice tone="danger" live title={error}/>}
    <CountryPicker visible={showCountry} value={details.nationality} title={text('الجنسية', 'Nationality')}
      allowed={details.category === 'gcc_citizen' ? gulf : otherCountries} onClose={() => setCountry(false)} onChange={nationality => setDetails({ ...details, nationality })}/>
  </View>;
}

const styles = StyleSheet.create({
  bar: { height: 4, borderRadius: 2, backgroundColor: color.border },
  option: { borderWidth: 2, borderColor: 'transparent', borderRadius: radius.md, padding: space.md, minHeight: 56, justifyContent: 'center', backgroundColor: color.bgField },
  optionOn: { borderColor: color.borderSelected, borderWidth: 2, backgroundColor: color.bgSelected },
  radio: { marginTop: 2, width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: color.borderControl, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.interactive },
  box: { marginTop: 2, width: 20, height: 20, borderRadius: 5, borderWidth: 2, borderColor: color.borderControl, alignItems: 'center', justifyContent: 'center' },
  select: { minHeight: 56, borderWidth: 1.5, borderColor: 'transparent', borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, justifyContent: 'center', backgroundColor: color.bgField },
  docRow: { gap: space.md, borderRadius: radius.md, padding: space.md, backgroundColor: color.bgSubtle },
  summary: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: color.bgMuted },
});
