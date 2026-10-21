import {useEffect,useState} from 'react';
import {ArrowUpRight,Check,ChevronLeft,FileImage,Globe2,LockKeyhole,LogOut,Mail,ShieldCheck,Sparkles,Upload,Copy} from 'lucide-react';
import {useLanguage} from '../i18n';
import BookingAPI from '../services/bookingApi';
import {saveUserSession,clearUserSession} from '../services/authSession';
import {membershipRequest} from '../services/membershipApi';
import {membershipCopy} from '../services/membershipCopy';
import countryCodes from '../../../shared/ratehawkResidencies.json';
import './MembershipPortal.css';
const gcc=['ae','sa','kw','qa','bh','om'];
const professions=['doctor','engineer','nurse','manager','supervisor','administrative'];
export function MembershipChrome({children,compact=false}){
    const {language,setLanguage,direction}=useLanguage(),L=membershipCopy(language);
    return <main className={`membership-site ${compact?'membership-compact':''}`} dir={direction}>
        <div className="membership-grain" aria-hidden="true" />
        <header className="membership-top"><a href="/" className="membership-brand"><span className="membership-mark">R</span><span><b>REMAL</b><small>{L.brand}</small></span></a><label className="membership-language"><Globe2 size={16}/><select aria-label="Language" value={language} onChange={e=>setLanguage(e.target.value)}><option value="ar">العربية</option><option value="en">English</option><option value="es">Español</option></select></label></header>
        {children}
        <footer className="membership-footer"><span>REMAL TOURISM · {new Date().getFullYear()}</span><div><a href={`/privacy?lang=${language}`}>{L.privacy}</a><a href={`/terms?lang=${language}`}>{L.terms}</a><a href="mailto:management@remaltourismllc.com">management@remaltourismllc.com</a></div></footer>
    </main>;
}
function Field({label,...props}){return <label className="membership-field"><span>{label}</span><input {...props}/></label>;}
export default function MembershipPortal({snapshot,refresh,go}){
    const {language}=useLanguage(),L=membershipCopy(language),app=snapshot?.application;
    const [mode,setMode]=useState('login'),[verify,setVerify]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const [form,setForm]=useState({name:'',email:'',password:'',phone:''}),[code,setCode]=useState('');
    const [phase,setPhase]=useState('eligibility'),[uploading,setUploading]=useState(''),[consent,setConsent]=useState(false);
    const [details,setDetails]=useState({category:'gcc_citizen',nationality:'',profession:'doctor',professionTitle:''});
    useEffect(()=>{if(app)setDetails({category:app.category||'gcc_citizen',nationality:app.nationality||'',profession:app.profession||'doctor',professionTitle:app.professionTitle||''});},[app?.reference]);
    const message=e=>({EMAIL_ALREADY_REGISTERED:L.emailRegistered,invalid_credentials:L.invalidCredentials,INVALID_VERIFICATION_CODE:L.codeInvalid,VERIFICATION_EMAIL_UNAVAILABLE:L.codeUnavailable,documents_required:L.documentsRequired,consent_required:L.consentRequired,application_changed:L.changed,invalid_document_image:L.invalidFile,document_too_large:L.invalidFile,invalid_document_size:L.invalidFile}[e?.response?.data?.error||e.code]||L.error);
    const run=async action=>{setBusy(true);setError('');try{await action();}catch(e){setError(message(e));}finally{setBusy(false);}};
    const auth=event=>{event.preventDefault();void run(async()=>{
        if(mode==='login'){const data=await BookingAPI.login({email:form.email,password:form.password});saveUserSession(data.user,data.access_token);await refresh();}
        else if(verify){const data=await BookingAPI.verifyRegistration(form.email,code);saveUserSession(data.user,data.access_token);go('/membership');await refresh();}
        else {await BookingAPI.registerSendCode(form);setVerify(true);}
    });};
    const save=event=>{event.preventDefault();void run(async()=>{await membershipRequest('/application',{method:'PUT',body:{...details,language}});await refresh();setPhase('documents');});};
    const upload=async(kind,file)=>{
        if(!file)return;if(!['image/jpeg','image/png'].includes(file.type)||file.size>5*1024*1024){setError(L.invalidFile);return;}
        setUploading(kind);setError('');try{await membershipRequest(`/application/documents/${kind}`,{method:'PUT',body:file});await refresh();}catch(e){setError(message(e));}finally{setUploading('');}
    };
    const submit=event=>{event.preventDefault();if(!consent){setError(L.consentRequired);return;}void run(async()=>{await membershipRequest('/application/submit',{method:'POST',body:{consent:true}});go('/membership');await refresh();});};
    const pending=app&&!['draft','needs_information'].includes(app.status),required=details.category==='gcc_citizen'?['passport']:['eid_front','eid_back'];
    let countries=[];try{const names=new Intl.DisplayNames([language],{type:'region'});countries=countryCodes.map(code=>({code,name:names.of(code.toUpperCase())})).sort((a,b)=>a.name.localeCompare(b.name,language));}catch{}
    return <MembershipChrome>
        <div className="membership-layout">
            <section className="membership-story"><span className="membership-eyebrow"><Sparkles size={15}/>{L.eyebrow}</span><h1>{L.title}</h1><p>{L.intro}</p><div className="membership-benefits">{[L.benefit1,L.benefit2,L.benefit3].map(text=><div key={text}><Check size={17}/><span>{text}</span></div>)}</div><div className="membership-free"><ShieldCheck size={24}/><div><strong>{L.free}</strong><span>{L.approval}</span></div></div><small className="membership-conditions">{L.conditions}</small><div className="membership-orbit" aria-hidden="true"><i/><i/><i/><span>R</span></div></section>
            <section className="membership-panel" aria-label={L.brand}>
                {snapshot?.authenticated&&<div className="membership-accountline"><span>{snapshot.user?.name}</span><button type="button" disabled={busy} onClick={()=>void run(async()=>{await BookingAPI.logoutUser();clearUserSession();await refresh();})}><LogOut size={15}/>{L.logout}</button></div>}
                {error&&<p role="alert" className="membership-error">{error}</p>}
                {!snapshot?.authenticated?<>
                    <div className="membership-tabs"><button type="button" className={mode==='login'?'active':''} onClick={()=>{setMode('login');setVerify(false);setError('');}}>{L.login}</button><button type="button" className={mode==='apply'?'active':''} onClick={()=>{setMode('apply');setVerify(false);setError('');}}>{L.apply}</button></div>
                    <div className="membership-panelheading"><span>{mode==='login'?L.welcome:L.free}</span><h2>{mode==='login'?L.loginTitle:verify?L.verifyTitle:L.accountTitle}</h2><p>{mode==='login'?L.loginHint:verify?L.verifyHint:L.accountHint}</p></div>
                    <form onSubmit={auth} className="membership-form">
                        {verify?<><p className="membership-email" dir="ltr">{form.email}</p><Field label={L.code} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={code} onChange={e=>setCode(e.target.value)}/></>:<>
                            {mode==='apply'&&<Field label={L.name} autoComplete="name" required maxLength={160} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/>}
                            <Field label={L.email} type="email" autoComplete="email" required value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/>
                            {mode==='apply'&&<Field label={L.phone} type="tel" autoComplete="tel" required maxLength={40} value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/>}
                            <Field label={L.password} type="password" autoComplete={mode==='login'?'current-password':'new-password'} minLength={mode==='apply'?10:undefined} required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>
                            {mode==='apply'&&<small>{L.passwordHint}</small>}
                        </>}
                        <button className="membership-primary" disabled={busy} type="submit">{busy?L.working:mode==='login'?L.signIn:verify?L.verify:L.continue}<ArrowUpRight size={18}/></button>
                        {verify&&<button type="button" className="membership-textbutton" onClick={()=>setVerify(false)}>{L.back}</button>}
                    </form>
                    <p className="membership-trust"><LockKeyhole size={15}/>{L.submitHint}</p>
                </>:pending?<div className="membership-status" data-membership-status={app.status}>
                    <div className={`membership-statusicon ${app.status==='approved'?'approved':''}`}>{app.status==='approved'?<Check size={32}/>:<ShieldCheck size={32}/>}</div>
                    <span className="membership-live"><i/>{L.live}</span><h2>{L[app.status]}</h2><p>{app.status==='approved'?L.approvedHint:app.status==='submitted'?L.submittedHint:app.status==='under_review'?L.reviewHint:app.status==='rejected'?L.rejectedHint:L.suspendedHint}</p>
                    {app.automatedReview&&['submitted','under_review'].includes(app.status)&&<section className="membership-analysis" aria-live="polite" aria-atomic="true" data-membership-analysis={app.automatedReview.phase}><strong>{language==='ar'?'فحص الأهلية والوثائق':'Document and eligibility check'}</strong><p>{({queued:language==='ar'?'طلبك في قائمة الفحص. سنعرض الخطوة التالية بمجرد بدئها.':'Your application is queued. The next step appears when it starts.',starting:language==='ar'?'بدأ فحص طلبك.':'Your application check has started.',reading_passport:language==='ar'?'نقرأ البيانات المكتوبة في صفحة جواز السفر.':'Reading the written fields on your passport identity page.',reading_id_front:language==='ar'?'نقرأ بيانات الوجه الأمامي للهوية الإماراتية.':'Reading the front of your Emirates ID.',reading_id_back:language==='ar'?'نقرأ بيانات الوجه الخلفي والمهنة المسجلة.':'Reading the reverse side and occupation fields.',matching:language==='ar'?'نطابق الاسم والجنسية والصلاحية وشروط فئة العضوية.':'Matching name, citizenship, validity and membership eligibility.',needs_review:language==='ar'?'تحتاج بعض البيانات إلى تدقيق إضافي. سيكمل فريق العضوية المراجعة، ولا يلزمك إعادة تقديم الطلب.':'Some fields need additional review. The membership team will continue checking; you do not need to submit again.'})[app.automatedReview.phase]}</p></section>}
                    <ol className="membership-timeline">{[L.received,L.checking,L.decision].map((step,i)=><li key={step} className={(i===0||i===1&&app.status!=='submitted'||i===2&&['approved','rejected','suspended'].includes(app.status))?'complete':''}><span>{i+1}</span>{step}</li>)}</ol>
                    <div className="membership-reference"><small>{L.reference}</small><b dir="ltr">{app.reference}</b><button type="button" aria-label={L.copy} onClick={()=>navigator.clipboard?.writeText(app.reference)}><Copy size={15}/>{L.copy}</button></div>
                    {app.publicNote&&<div className="membership-notebox"><strong>{L.note}</strong><p>{app.publicNote}</p></div>}
                    {!app.grandfathered&&<p className="membership-notification"><Mail size={17}/>{snapshot.notification?.status==='sent'?L.emailSent:snapshot.notification?.status==='unknown'?(language==='ar'?'أحدث حالة لطلبك متاحة هنا. لم نتأكد من تسليم إشعار البريد بعد.':'Your latest status is available here. Email delivery has not been confirmed yet.'):L.emailPending}</p>}
                    {app.status==='approved'&&<button type="button" className="membership-primary" onClick={()=>go('/')}>{L.enter}<ArrowUpRight size={18}/></button>}
                    {app.status==='suspended'&&<div className="membership-servicing"><button type="button" onClick={()=>go('/bookings')}>{L.bookings}</button><button type="button" onClick={()=>go('/support')}>{L.support}</button></div>}
                    <small className="membership-lastchecked">{L.checked}: {snapshot.checkedAt?new Intl.DateTimeFormat(language,{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(snapshot.checkedAt):'—'}</small>
                </div>:<>
                    <div className="membership-panelheading"><span>{L.free}</span><h2>{phase==='eligibility'?L.eligibilityTitle:L.documents}</h2><p>{L.eligibilityHint}</p></div>
                    {app?.publicNote&&<div className="membership-notebox"><strong>{L.note}</strong><p>{app.publicNote}</p></div>}
                    <div className="membership-steps"><span className={phase==='eligibility'?'active':''}>01 · {L.eligibility}</span><span className={phase==='documents'?'active':''}>02 · {L.documents}</span></div>
                    {phase==='eligibility'?<form className="membership-form" onSubmit={save}>
                        {['gcc_citizen','uae_professional'].map(category=><label key={category} className={`membership-category ${details.category===category?'selected':''}`}><input type="radio" name="category" value={category} checked={details.category===category} onChange={()=>setDetails({...details,category,nationality:''})}/><span><strong>{category==='gcc_citizen'?L.gcc:L.professional}</strong><small>{category==='gcc_citizen'?L.gccHint:L.professionalHint}</small></span></label>)}
                        <label className="membership-field"><span>{L.nationality}</span><select required value={details.nationality} onChange={e=>setDetails({...details,nationality:e.target.value})}><option value="">{L.choose}</option>{countries.filter(c=>details.category==='gcc_citizen'?gcc.includes(c.code):!gcc.includes(c.code)).map(country=><option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
                        {details.category==='uae_professional'&&<><label className="membership-field"><span>{L.profession}</span><select required value={details.profession} onChange={e=>setDetails({...details,profession:e.target.value})}>{professions.map(profession=><option key={profession} value={profession}>{L[profession]}</option>)}</select></label><Field label={L.professionTitle} required maxLength={160} value={details.professionTitle} onChange={e=>setDetails({...details,professionTitle:e.target.value})}/></>}
                        <button className="membership-primary" disabled={busy} type="submit">{busy?L.working:L.continue}<ArrowUpRight size={18}/></button>
                    </form>:<form className="membership-form" onSubmit={submit}>
                        <p className="membership-documenthint">{L.documentHint}</p>
                        {required.map(kind=>{const uploaded=app?.documents?.some(doc=>doc.kind===kind);return <label key={kind} className={`membership-upload ${uploaded?'uploaded':''}`}><span className="membership-uploadicon">{uploaded?<Check size={22}/>:<FileImage size={22}/>}</span><span><strong>{L[kind]}</strong><small>{uploading===kind?L.uploading:uploaded?L.uploaded:L.fileHint}</small><b>{uploaded?L.replace:L.selectFile}</b></span><input type="file" accept="image/jpeg,image/png" disabled={Boolean(uploading)||busy} aria-label={L[kind]} onChange={e=>{void upload(kind,e.target.files?.[0]);e.target.value='';}}/></label>;})}
                        <p className="membership-private-note"><LockKeyhole size={17}/>{L.privacyHint}</p>
                        <label className="membership-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{L.consent} <a href={`/privacy?lang=${language}`}>{L.privacy}</a></span></label>
                        <button className="membership-primary" disabled={busy||Boolean(uploading)||!required.every(kind=>app?.documents?.some(doc=>doc.kind===kind))} type="submit">{busy?L.working:L.submit}<ArrowUpRight size={18}/></button><button className="membership-textbutton" type="button" onClick={()=>setPhase('eligibility')}><ChevronLeft size={15}/>{L.back}</button>
                    </form>}
                </>}
            </section>
        </div>
    </MembershipChrome>;
}
