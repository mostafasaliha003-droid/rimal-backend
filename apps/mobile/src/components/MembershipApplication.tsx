import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { api, ApiError, authSession, COUNTRY_CODES, websiteUrl } from '../api';
import type { DocumentKind, MemberCategory, MemberDetails, MemberStatus } from '../api/membership';
import { useLanguage } from '../i18n';
import { colors, ui } from '../theme';
import { Button, Field, Row, Txt } from './Primitives';
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
  return <View style={{ gap: 12 }}>
    <Row style={{ flexWrap: 'wrap', gap: 6 }}>{(Object.keys(stepLabels) as Step[]).map((key, i) =>
      <Txt key={key} kind="small" style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 14,
        overflow: 'hidden', backgroundColor: step === key ? colors.lilac : colors.canvas }}>{i + 1} · {stepLabels[key][lang]}</Txt>)}</Row>
    {step === 'eligibility' ? <>
      {(['gcc_citizen','uae_professional'] as const).map(category => <Button key={category}
        variant={details.category === category ? 'primary' : 'secondary'} disabled={busy} onPress={() => chooseCategory(category)}
        title={category === 'gcc_citizen' ? text('مواطن خليجي', 'GCC citizen') : text('مهني مقيم في الإمارات', 'UAE resident professional')}/>)}
      <Button variant="secondary" disabled={busy} title={text('الجنسية', 'Nationality') + (details.nationality ? ' · ' + countryName(details.nationality, language) : '')}
        onPress={() => setCountry(true)}/>
      {details.category === 'uae_professional' && <><Button variant="secondary" disabled={busy} title={text('المهنة', 'Profession') +
        (details.profession ? ' · ' + (ar ? professions[details.profession as keyof typeof professions] : details.profession) : '')}
        onPress={() => setProfession(!showProfession)}/>
        {showProfession && <View style={{ gap: 3 }}>{Object.entries(professions).map(([key, label]) => <Button compact key={key}
          variant="quiet" title={ar ? label : key} onPress={() => { setDetails({ ...details, profession: key }); setProfession(false); }}/>)}</View>}
        <Field label={text('المسمى المهني كما في الهوية', 'Job title as printed on your ID')} maxLength={160}
          value={details.professionTitle} onChangeText={professionTitle => setDetails({ ...details, professionTitle })}/></>}
      <Button title={text('متابعة إلى الوثائق', 'Continue to documents')} busy={busy} disabled={!valid} onPress={() => void save()}/>
    </> : step === 'documents' ? <>
      <Txt kind="small">{text('اختر صورة JPG أو PNG لكل وثيقة، بحد أقصى 5 ميغابايت للصورة.', 'Choose a JPG or PNG for each document, up to 5 MB each.')}</Txt>
      {needed.map(kind => <Button key={kind} variant="secondary" disabled={busy} title={labels[kind][lang] + (docs.includes(kind) ? ' ✓' : '')}
        onPress={() => void upload(kind)}/>)}
      <Button title={text('مراجعة الطلب', 'Review application')} disabled={busy || !allUploaded} onPress={() => setStep('review')}/>
      <Button variant="quiet" title={text('تعديل بيانات الأهلية', 'Edit eligibility')} disabled={busy} onPress={() => setStep('eligibility')}/>
    </> : <>
      <Txt kind="label">{countryName(details.nationality, language)}</Txt>
      {!!details.professionTitle && <Txt>{details.professionTitle}</Txt>}
      {needed.map(kind => <Txt key={kind}>{labels[kind][lang]} ✓</Txt>)}
      <View style={ui.rule}/>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: consent }} aria-checked={consent} disabled={busy}
        onPress={() => setConsent(!consent)} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Txt>{consent ? '☑ ' : '☐ '}{text('أؤكد صحة البيانات وأوافق على استخدام الوثائق لمراجعة أهليتي للعضوية.', 'I confirm my information is accurate and consent to use of my documents to review eligibility.')}</Txt>
      </Pressable>
      <Button variant="quiet" title={text('سياسة الخصوصية', 'Privacy policy')}
        onPress={() => { void WebBrowser.openBrowserAsync(websiteUrl('/privacy')).catch(() => setError(text('تعذّر فتح السياسة', 'Could not open policy'))); }}/>
      <Button title={text('إرسال طلب العضوية', 'Submit membership application')} disabled={!consent} busy={busy} onPress={() => void submit()}/>
      <Button variant="quiet" title={text('مراجعة الوثائق', 'Back to documents')} disabled={busy} onPress={() => setStep('documents')}/>
    </>}
    {!!error && <Txt accessibilityRole="alert" style={{ color: colors.red }}>{error}</Txt>}
    <CountryPicker visible={showCountry} value={details.nationality} title={text('الجنسية', 'Nationality')}
      allowed={details.category === 'gcc_citizen' ? gulf : otherCountries} onClose={() => setCountry(false)} onChange={nationality => setDetails({ ...details, nationality })}/>
  </View>;
}
