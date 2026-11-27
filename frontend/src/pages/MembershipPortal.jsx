import {useEffect,useState} from 'react';
import {ArrowUpRight,Check,ChevronLeft,FileImage,Globe2,LockKeyhole,LogOut,Mail,ShieldCheck,Sparkles,Copy,Hotel,Tickets,Plane,ChevronDown} from 'lucide-react';
import {useLanguage} from '../i18n';
import BookingAPI from '../services/bookingApi';
import {saveUserSession,clearUserSession} from '../services/authSession';
import {membershipRequest} from '../services/membershipApi';
import {membershipCopy} from '../services/membershipCopy';
import countryCodes from '../../../shared/ratehawkResidencies.json';
import professions from '../../../shared/membershipProfessions.json';
import './MembershipPortal.css';
import MembershipDocumentField from '../components/MembershipDocumentField';
import PillowBrand from '../components/PillowBrand';
import {LandingHero,HowItWorks,AppShowcase,LandingFaq} from '../components/MkhaddaLanding';
import CompanyFooter from '../components/CompanyFooter';
import MembershipDiscover from '../components/MembershipDiscover';
const gcc=['ae','sa','kw','qa','bh','om'];
// Password recovery: an e-mailed 6-digit code, then a new password. The server answers the same whether or not the address has an account.
const recoveryCopy={
    ar:{forgot:'نسيت كلمة المرور؟',eyebrow:'استرجاع الحساب',askTitle:'لنرجعك إلى حسابك',askHint:'اكتب بريدك الإلكتروني ونرسل لك رمزًا من 6 أرقام لتعيين كلمة مرور جديدة.',send:'أرسل الرمز',resetTitle:'عيّن كلمة مرور جديدة',resetHint:'إذا كان هذا البريد مسجّلًا لدينا، فقد أرسلنا إليه رمزًا صالحًا لمدة 10 دقائق.',newPassword:'كلمة المرور الجديدة',save:'احفظ وادخل',resend:'أرسل رمزًا جديدًا',resent:'طلبنا رمزًا جديدًا. قد يستغرق وصوله دقيقة.',back:'العودة لتسجيل الدخول',badCode:'الرمز غير صحيح أو انتهت صلاحيته. اطلب رمزًا جديدًا.',tooMany:'محاولات كثيرة. انتظر بضع دقائق ثم أعد المحاولة.',mailDown:'تعذّر إرسال البريد الآن. حاول بعد قليل.',everywhere:'بعد الحفظ نُخرج حسابك من الأجهزة الأخرى حفاظًا على أمانه.'},
    en:{forgot:'Forgot your password?',eyebrow:'Account recovery',askTitle:'Let’s get you back in',askHint:'Enter your email and we’ll send a 6-digit code to set a new password.',send:'Send the code',resetTitle:'Set a new password',resetHint:'If this address has an account, we’ve sent it a code that works for 10 minutes.',newPassword:'New password',save:'Save and sign in',resend:'Send a new code',resent:'We’ve asked for a new code. It may take a minute to arrive.',back:'Back to sign in',badCode:'That code is wrong or has expired. Ask for a new one.',tooMany:'Too many tries. Wait a few minutes and try again.',mailDown:'We couldn’t send the email right now. Try again shortly.',everywhere:'Saving signs your account out on every other device, to keep it safe.'},
    es:{forgot:'¿Olvidaste tu contraseña?',eyebrow:'Recuperar cuenta',askTitle:'Volvamos a tu cuenta',askHint:'Escribe tu correo y te enviaremos un código de 6 dígitos para crear una contraseña nueva.',send:'Enviar el código',resetTitle:'Crea una contraseña nueva',resetHint:'Si este correo tiene una cuenta, le hemos enviado un código válido durante 10 minutos.',newPassword:'Contraseña nueva',save:'Guardar y entrar',resend:'Enviar un código nuevo',resent:'Hemos pedido un código nuevo. Puede tardar un minuto en llegar.',back:'Volver a iniciar sesión',badCode:'El código es incorrecto o ha caducado. Pide uno nuevo.',tooMany:'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.',mailDown:'No pudimos enviar el correo ahora. Inténtalo en un momento.',everywhere:'Al guardar cerramos tu sesión en los demás dispositivos, por seguridad.'}
};
export function MembershipChrome({children,compact=false,onLogin}){
    const {language,setLanguage,direction,t}=useLanguage(),L=membershipCopy(language);
    return <main className={`membership-site ${compact?'membership-compact':''}`} dir={direction}>
        <div className="membership-grain" aria-hidden="true" />
        <header className="membership-header"><div className="membership-top"><a href="/" data-membership-logo><PillowBrand /></a><div className="membership-header-tools">{onLogin?<button type="button" className="mk-header-login" data-header-login onClick={onLogin}>{L.login}</button>:<span className="membership-header-access"><ShieldCheck size={16}/>{L.brand}</span>}<label className="membership-language"><Globe2 size={16}/><select aria-label={t('nav.language','اللغة')} value={language} onChange={e=>setLanguage(e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="es">Español</option></select></label></div></div></header>
        {children}
        <CompanyFooter />
    </main>;
}
function Field({label,...props}){return <label className="membership-field"><span>{label}</span><input {...props}/></label>;}
export default function MembershipPortal({snapshot,refresh,go,onEnter}){
    const {language}=useLanguage(),L=membershipCopy(language),app=snapshot?.application;
    const [mode,setMode]=useState('login'),[verify,setVerify]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const R=recoveryCopy[language]||recoveryCopy.en,[recover,setRecover]=useState(null),[notice,setNotice]=useState('');
    const show=next=>{setMode(next);setVerify(false);setRecover(null);setError('');setNotice('');};
    // The form closes the public page, so every invitation to apply or sign in brings the visitor to it.
    const toForm=next=>event=>{event?.preventDefault?.();show(next);requestAnimationFrame(()=>{const panel=document.getElementById('membership-application');panel?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});panel?.querySelector('input')?.focus({preventScroll:true});});};
    const [resendAt,setResendAt]=useState(0),[clock,setClock]=useState(Date.now);
    useEffect(()=>{if(!verify)return;const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[verify]);
    const waitSeconds=Math.max(0,Math.ceil((resendAt-clock)/1000));
    const sendCode=async()=>{await BookingAPI.registerSendCode(form);const now=Date.now();setResendAt(now+30000);setClock(now);setVerify(true);};
    const [form,setForm]=useState({name:'',email:'',password:'',phone:''}),[code,setCode]=useState('');
    const [unsubmitted,setUnsubmitted]=useState({});
    const [phase,setPhase]=useState('eligibility'),[uploading,setUploading]=useState(''),[consent,setConsent]=useState(false);
    const [details,setDetails]=useState({category:'gcc_citizen',nationality:'',profession:'doctor',professionTitle:''});
    useEffect(()=>{if(app)setDetails({category:app.category||'gcc_citizen',nationality:app.nationality||'',profession:app.profession||'doctor',professionTitle:app.professionTitle||''});},[app?.reference]);
    const message=e=>e?.response?.status===429?R.tooMany:({INVALID_RESET_CODE:R.badCode,INVALID_PASSWORD:L.passwordHint,PASSWORD_RESET_EMAIL_UNAVAILABLE:R.mailDown,EMAIL_ALREADY_REGISTERED:L.emailRegistered,invalid_credentials:L.invalidCredentials,INVALID_VERIFICATION_CODE:L.codeInvalid,VERIFICATION_EMAIL_UNAVAILABLE:L.codeUnavailable,documents_required:L.documentsRequired,consent_required:L.consentRequired,application_changed:L.changed,invalid_document_image:L.invalidFile,document_too_large:L.invalidFile,invalid_document_size:L.invalidFile}[e?.response?.data?.error||e.code]||L.error);
    const run=async action=>{setBusy(true);setError('');setNotice('');try{await action();}catch(e){setError(message(e));}finally{setBusy(false);}};
    const auth=event=>{event.preventDefault();void run(async()=>{
        if(mode==='login'&&recover==='ask'){await BookingAPI.requestPasswordReset(form.email.trim());setCode('');setForm(current=>({...current,password:''}));setRecover('reset');}
        else if(mode==='login'&&recover==='reset'){const data=await BookingAPI.resetPassword(form.email.trim(),code,form.password);saveUserSession(data.user,data.access_token);setRecover(null);setCode('');await refresh();}
        else if(mode==='login'){const data=await BookingAPI.login({email:form.email,password:form.password});saveUserSession(data.user,data.access_token);await refresh();}
        else if(verify){const data=await BookingAPI.verifyRegistration(form.email,code);saveUserSession(data.user,data.access_token);go('/membership');await refresh();}
        else {await sendCode();}
    });};
    const save=event=>{event.preventDefault();void run(async()=>{await membershipRequest('/application',{method:'PUT',body:{...details,language}});await refresh();setPhase('documents');});};
    const upload=async(kind,file)=>{

        setUploading(kind);try{await membershipRequest(`/application/documents/${kind}`,file?{method:'PUT',body:file}:{method:'DELETE',body:{revision:app?.revision}});await refresh();}catch(e){throw new Error(message(e));}finally{setUploading('');}
    };
    const submit=event=>{event.preventDefault();if(!consent){setError(L.consentRequired);return;}void run(async()=>{await membershipRequest('/application/submit',{method:'POST',body:{consent:true}});go('/membership');await refresh();});};
    const pending=app&&!['draft','needs_information'].includes(app.status),required=details.category==='gcc_citizen'?['passport']:['eid_front','eid_back'];
    let countries=[];try{const names=new Intl.DisplayNames([language],{type:'region'});countries=countryCodes.map(code=>({code,name:names.of(code.toUpperCase())})).sort((a,b)=>a.name.localeCompare(b.name,language));}catch{}
    const visitor=!snapshot?.authenticated;
    return <MembershipChrome onLogin={visitor?toForm('login'):undefined}>
        {visitor && <><LandingHero applyLabel={L.apply} loginLabel={L.login} onApply={toForm('apply')} onLogin={toForm('login')} /><MembershipDiscover onApply={toForm('apply')} /><HowItWorks /><AppShowcase /><LandingFaq /></>}
        <div className={`membership-layout ${snapshot?.authenticated?'membership-authenticated':'mk-closing'}`}>
            <section className="membership-story"><span className="membership-eyebrow"><Sparkles size={15}/>{L.eyebrow}</span><h2>{L.brand}</h2><p>{L.intro}</p><div className="membership-benefits">{[[Hotel,L.benefit1],[Globe2,L.benefit2],[Tickets,L.benefit3]].map(([Icon,text])=><div key={text}><span className="membership-benefit-icon"><Icon size={19}/></span><span>{text}</span></div>)}</div>{!visitor&&<div className="membership-free"><ShieldCheck size={24}/><div><strong>{L.free}</strong><span>{L.approval}</span></div><Check size={18}/></div>}<small className="membership-conditions">{L.conditions}</small></section>
            <section id="membership-application" className="membership-panel" aria-label={L.brand}>
                {snapshot?.authenticated&&<div className="membership-accountline"><span>{snapshot.user?.name}</span><button type="button" disabled={busy} onClick={()=>void run(async()=>{await BookingAPI.logoutUser();clearUserSession();await refresh();})}><LogOut size={15}/>{L.logout}</button></div>}
                {error&&<p role="alert" className="membership-error">{error}</p>}
                {!snapshot?.authenticated?<>
                    <div className="membership-tabs"><button type="button" className={mode==='login'?'active':''} onClick={()=>show('login')}>{L.login}</button><button type="button" className={mode==='apply'?'active':''} onClick={()=>show('apply')}>{L.apply}</button></div>
                    <div className="membership-panelheading" data-membership-recover={recover||undefined}><span>{recover?R.eyebrow:mode==='login'?L.welcome:L.free}</span><h2>{recover==='ask'?R.askTitle:recover==='reset'?R.resetTitle:mode==='login'?L.loginTitle:verify?L.verifyTitle:L.accountTitle}</h2><p>{recover==='ask'?R.askHint:recover==='reset'?R.resetHint:mode==='login'?L.loginHint:verify?L.verifyHint:L.accountHint}</p></div>
                    <form onSubmit={auth} className="membership-form">
                        {recover==='ask'?<Field label={L.email} type="email" autoComplete="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
                        :recover==='reset'?<><p className="membership-email" dir="ltr">{form.email}</p><Field label={L.code} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value.replace(/[^0-9]/g,''))}/><Field label={R.newPassword} type="password" autoComplete="new-password" minLength={10} maxLength={256} required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><small>{L.passwordHint}. {R.everywhere}</small></>
                        :verify?<><p className="membership-email" dir="ltr">{form.email}</p><Field label={L.code} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)}/></>:<>
                            {mode==='apply'&&<Field label={L.name} autoComplete="name" required maxLength={160} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>}
                            <Field label={L.email} type="email" autoComplete="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
                            {mode==='apply'&&<Field label={L.phone} type="tel" autoComplete="tel" required maxLength={40} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>}
                            <Field label={L.password} type="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='apply'?10:undefined} required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
                            {mode==='apply'&&<small>{L.passwordHint}</small>}
                            {mode==='login'&&<button type="button" className="membership-forgot" data-membership-forgot onClick={()=>{setRecover('ask');setError('');setNotice('');setForm(current=>({...current,password:''}));}}>{R.forgot}</button>}
                        </>}
                        {notice&&<p role="status" className="membership-notice">{notice}</p>}
                        <button className="membership-primary" disabled={busy} type="submit">{busy?L.working:recover==='ask'?R.send:recover==='reset'?R.save:mode==='login'?L.signIn:verify?L.verify:L.continue}<ArrowUpRight size={18}/></button>
                        {recover==='reset'&&<button type="button" className="membership-textbutton" disabled={busy} onClick={()=>void run(async()=>{await BookingAPI.requestPasswordReset(form.email.trim());setNotice(R.resent);})}>{R.resend}</button>}
                        {recover&&<button type="button" className="membership-textbutton" disabled={busy} onClick={()=>show('login')}>{R.back}</button>}
                        {verify&&<button type="button" className="membership-textbutton" disabled={busy||waitSeconds>0} onClick={()=>void run(sendCode)}>{language==='ar'?'إعادة إرسال الرمز':language==='es'?'Reenviar código':'Resend code'}{waitSeconds>0 && <bdi>{waitSeconds}s</bdi>}</button>}
                        {verify&&<button type="button" className="membership-textbutton" onClick={()=>setVerify(false)}>{L.back}</button>}
                    </form>
                    <p className="membership-trust"><LockKeyhole size={15}/>{L.submitHint}</p>
                    <details className="membership-audience"><summary><ShieldCheck size={17}/><span>{language==='ar'?'هل العضوية مناسبة لك؟':language==='es'?'¿Quién puede solicitarla?':'Who can apply?'}</span><ChevronDown size={16}/></summary><div><section><h3>{L.gcc}</h3><p>{L.gccHint}</p></section><section><h3>{L.professional}</h3><p>{L.professionalHint}</p></section><p className="membership-audience-note">{L.eligibilityHint}</p></div></details>
                </>:pending?<div className="membership-status" data-membership-status={app.status}>
                    <div className={`membership-statusicon ${app.status==='approved'?'approved':''}`}>{app.status==='approved'?<Check size={32}/>:<ShieldCheck size={32}/>}</div>
                    <span className="membership-live"><i/>{L.live}</span><h2>{L[app.status]}</h2><p>{app.status==='approved'?L.approvedHint:app.status==='submitted'?L.submittedHint:app.status==='under_review'?L.reviewHint:app.status==='rejected'?L.rejectedHint:L.suspendedHint}</p>
                    {app.automatedReview&&['submitted','under_review'].includes(app.status)&&<section className="membership-analysis" aria-live="polite" aria-atomic="true" data-membership-analysis={app.automatedReview.phase}><strong>{language==='ar'?'فحص الأهلية والوثائق':'Document and eligibility check'}</strong><p>{({queued:language==='ar'?'طلبك في قائمة الفحص. سنعرض الخطوة التالية بمجرد بدئها.':'Your application is queued. The next step appears when it starts.',starting:language==='ar'?'بدأ فحص طلبك.':'Your application check has started.',reading_passport:language==='ar'?'نقرأ البيانات المكتوبة في صفحة جواز السفر.':'Reading the written fields on your passport identity page.',reading_id_front:language==='ar'?'نقرأ بيانات الوجه الأمامي للهوية الإماراتية.':'Reading the front of your Emirates ID.',reading_id_back:language==='ar'?'نقرأ بيانات الوجه الخلفي والمهنة المسجلة.':'Reading the reverse side and occupation fields.',matching:language==='ar'?'نطابق الاسم والجنسية والصلاحية وشروط فئة العضوية.':'Matching name, citizenship, validity and membership eligibility.',needs_review:language==='ar'?'تحتاج بعض البيانات إلى تدقيق إضافي. سيكمل فريق العضوية المراجعة، ولا يلزمك إعادة تقديم الطلب.':'Some fields need additional review. The membership team will continue checking; you do not need to submit again.'})[app.automatedReview.phase]}</p></section>}
                    <ol className="membership-timeline">{[L.received,L.checking,L.decision].map((step,i)=><li key={step} className={(i===0||i===1&&app.status!=='submitted'||i===2&&['approved','rejected','suspended'].includes(app.status))?'complete':''}><span>{i+1}</span>{step}</li>)}</ol>
                    <div className="membership-reference"><small>{L.reference}</small><b dir="ltr">{app.reference}</b><button type="button" aria-label={L.copy} onClick={()=>navigator.clipboard?.writeText(app.reference)}><Copy size={15}/>{L.copy}</button></div>
                    {app.publicNote&&<div className="membership-notebox"><strong>{L.note}</strong><p>{app.publicNote}</p></div>}
                    {!app.grandfathered&&<p className="membership-notification"><Mail size={17}/>{snapshot.notification?.status==='sent'?L.emailSent:snapshot.notification?.status==='unknown'?(language==='ar'?'أحدث حالة لطلبك متاحة هنا. لم نتأكد من تسليم إشعار البريد بعد.':'Your latest status is available here. Email delivery has not been confirmed yet.'):L.emailPending}</p>}
                    {app.status==='approved'&&<button type="button" className="membership-primary" onClick={onEnter||(()=>go('/'))}>{L.enter}<ArrowUpRight size={18}/></button>}
                    {app.status==='suspended'&&<div className="membership-servicing"><button type="button" onClick={()=>go('/bookings')}>{L.bookings}</button><button type="button" onClick={()=>go('/support')}>{L.support}</button></div>}
                    <small className="membership-lastchecked">{L.checked}: {snapshot.checkedAt?new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(snapshot.checkedAt):'—'}</small>
                </div>:<>
                    <div className="membership-panelheading"><span>{L.free}</span><h2>{phase==='eligibility'?L.eligibilityTitle:L.documents}</h2><p>{L.eligibilityHint}</p></div>
                    {app?.publicNote&&<div className="membership-notebox"><strong>{L.note}</strong><p>{app.publicNote}</p></div>}
                    <div className="membership-steps"><span className={phase==='eligibility'?'active':''}>01 · {L.eligibility}</span><span className={phase==='documents'?'active':''}>02 · {L.documents}</span></div>
                    {phase==='eligibility'?<form className="membership-form" onSubmit={save}>
                        {['gcc_citizen','uae_professional'].map(category=><label key={category} className={`membership-category ${details.category===category?'selected':''}`}><input type="radio" name="category" value={category} checked={details.category===category} onChange={()=>setDetails({...details,category,nationality:''})}/><span><strong>{category==='gcc_citizen'?L.gcc:L.professional}</strong><small>{category==='gcc_citizen'?L.gccHint:L.professionalHint}</small></span></label>)}
                        <label className="membership-field"><span>{L.nationality}</span><select required value={details.nationality} onChange={e=>setDetails({...details,nationality:e.target.value})}><option value="">{L.choose}</option>{countries.filter(c=>details.category==='gcc_citizen'?gcc.includes(c.code):!gcc.includes(c.code)).map(country=><option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
                        {details.category==='uae_professional'&&<><label className="membership-field"><span>{L.profession}</span><select name="profession" required value={details.profession} onChange={e=>setDetails({...details,profession:e.target.value,professionTitle:''})}>{professions.map(profession=><option key={profession} value={profession}>{L[profession]}</option>)}</select></label><Field name="professionTitle" label={L.professionTitle} required minLength={2} maxLength={160} aria-describedby="membership-occupation-hint" value={details.professionTitle} onChange={e=>setDetails({...details,professionTitle:e.target.value})}/><small id="membership-occupation-hint">{details.profession==='other'?L.otherProfessionHint:L.professionTitleHint}</small></>}
                        <button className="membership-primary" disabled={busy} type="submit">{busy?L.working:L.continue}<ArrowUpRight size={18}/></button>
                    </form>:<form className="membership-form" onSubmit={submit}>
                        <p className="membership-documenthint">{L.documentHint}</p>
                        {required.map(kind=><MembershipDocumentField key={kind} kind={kind} reference={app?.reference} uploaded={app?.documents?.some(doc=>doc.kind===kind)} busy={Boolean(uploading)||busy} L={L} save={upload} onDirty={(key,value)=>setUnsubmitted(current=>({...current,[key]:value}))} />)}
                        <p className="membership-private-note"><LockKeyhole size={17}/>{L.privacyHint}</p>
                        <label className="membership-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{L.consent} <a href={`/privacy?lang=${language}`}>{L.privacy}</a></span></label>
                        <button className="membership-primary" disabled={busy||Boolean(uploading)||required.some(kind=>unsubmitted[kind])||!required.every(kind=>app?.documents?.some(doc=>doc.kind===kind))} type="submit">{busy?L.working:L.submit}<ArrowUpRight size={18}/></button><button className="membership-textbutton" type="button" onClick={()=>{setUnsubmitted({});setPhase('eligibility');}}><ChevronLeft size={15}/>{L.back}</button>
                    </form>}
                </>}
            </section>
        </div>
    </MembershipChrome>;
}
