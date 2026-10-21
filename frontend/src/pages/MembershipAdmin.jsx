import {useCallback,useEffect,useRef,useState} from 'react';
import {Check,FileImage,RefreshCw,ShieldCheck,X} from 'lucide-react';
import {useLanguage} from '../i18n';
import {membershipRequest,membershipDocument} from '../services/membershipApi';
import {membershipCopy} from '../services/membershipCopy';
import {supportRequest,STAFF_TOKEN_KEY} from '../services/customerSupport';
import {MembershipChrome} from './MembershipPortal';
import './MembershipAdmin.css';

function DocumentViewer({reference,kind,close,L}){
    const [url,setUrl]=useState(''),[error,setError]=useState(false),dialog=useRef(null);
    useEffect(()=>{let blobUrl,alive=true;const controller=new AbortController();
        membershipDocument(reference,kind,{staff:true,signal:controller.signal}).then(blob=>{if(alive){blobUrl=URL.createObjectURL(blob);setUrl(blobUrl);}}).catch(()=>{if(alive)setError(true);});
        const previousFocus=window.document.activeElement,previousOverflow=window.document.body.style.overflow;window.document.body.style.overflow='hidden';
        const escape=event=>{if(event.key==='Escape')close();if(event.key==='Tab'){event.preventDefault();dialog.current?.querySelector('button')?.focus();}};window.document.addEventListener('keydown',escape);
        return()=>{alive=false;controller.abort();if(blobUrl)URL.revokeObjectURL(blobUrl);window.document.removeEventListener('keydown',escape);window.document.body.style.overflow=previousOverflow;previousFocus?.focus?.();};
    },[reference,kind]);
    return <div ref={dialog} className="membership-document-modal" role="dialog" aria-modal="true" aria-label={L[kind]}><div><header><h2>{L[kind]}</h2><button autoFocus onClick={close} aria-label="Close"><X/></button></header>{error?<p role="alert">{L.unavailable}</p>:url?<img src={url} alt={L[kind]}/>:<p role="status">{L.working}</p>}</div></div>;
}
export default function MembershipAdmin(){
    const {language}=useLanguage(),ar=language==='ar',L=membershipCopy(language);
    const [authenticated,setAuthenticated]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
    const [credentials,setCredentials]=useState({email:'',password:''}),[rows,setRows]=useState([]),[filter,setFilter]=useState('submitted'),[search,setSearch]=useState(''),[selected,setSelected]=useState(''),[detail,setDetail]=useState(null),[document,setDocument]=useState(''),[verified,setVerified]=useState(false),[note,setNote]=useState(''),[hasMore,setHasMore]=useState(false);
    const requestSequence=useRef(0);
    const denied=e=>{setError(e.status===409?L.changed:L.error);if(e.status===401||e.status===403){setAuthenticated(false);setDetail(null);setDocument('');setRows([]);sessionStorage.removeItem(STAFF_TOKEN_KEY);}};
    useEffect(()=>{let alive=true;supportRequest('/session',{staff:true,auth:true}).then(()=>{if(alive)setAuthenticated(true);}).catch(()=>{}).finally(()=>{if(alive)setReady(true);});return()=>{alive=false;};},[]);
    const reload=useCallback(async()=>{
        if(!authenticated)return;
        const sequence=++requestSequence.current;
        try{const result=await membershipRequest(`/applications?status=${filter}`,{staff:true});if(sequence!==requestSequence.current)return;setRows(result.applications);setHasMore(result.hasMore);if(selected){const data=await membershipRequest(`/applications/${selected}`,{staff:true});if(sequence===requestSequence.current)setDetail(data);}}
        catch(e){denied(e);}
    },[authenticated,filter,selected]);
    useEffect(()=>{void reload();const timer=setInterval(()=>{if(!window.document.hidden)void reload();},15000);return()=>{++requestSequence.current;clearInterval(timer);};},[reload]);
    useEffect(()=>{setDetail(null);setDocument('');setVerified(false);setNote('');},[selected]);
    useEffect(()=>setVerified(false),[detail?.application?.revision]);
    const login=async event=>{event.preventDefault();setBusy(true);setError('');try{const data=await supportRequest('/login',{staff:true,auth:true,method:'POST',body:credentials});sessionStorage.setItem(STAFF_TOKEN_KEY,data.access_token);setCredentials({email:'',password:''});setAuthenticated(true);}catch(e){denied(e);}finally{setBusy(false);}};
    const review=async action=>{
        if(!detail||detail.application.reference!==selected||busy)return;setBusy(true);setError('');
        try{await membershipRequest(`/applications/${selected}/review`,{staff:true,method:'POST',body:{action,revision:detail.application.revision,publicNote:note,documentsVerified:verified}});setVerified(false);setNote('');await reload();}
        catch(e){denied(e);await reload();}finally{setBusy(false);}
    };
    const row=detail?.application,reviewable=row&&['submitted','under_review','needs_information'].includes(row.status);
    const date=value=>value?new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';
    const visible=rows.filter(row=>`${row.applicant?.name||''} ${row.applicant?.email||''} ${row.reference}`.toLowerCase().includes(search.toLowerCase()));
    return <MembershipChrome compact><section className="membership-admin-heading"><div><span className="membership-eyebrow"><ShieldCheck size={16}/>REMAL MEMBERSHIP DESK</span><h1>{ar?'مراجعة طلبات العضوية':'Membership applications'}</h1><p>{ar?'راجع الأهلية والوثائق، ثم أرسل قرارًا واضحًا للعميل.':'Review eligibility and documents, then share a clear decision with the applicant.'}</p></div><a href="/customer-service">{ar?'خدمة العملاء':'Customer service'} ↗</a></section>
        {error&&<p className="membership-error" role="alert">{error}</p>}
        {!ready?<p role="status">{L.working}</p>:!authenticated?<section className="membership-panel membership-admin-login"><h2>{ar?'دخول فريق العضوية':'Membership team sign-in'}</h2><form onSubmit={login} className="membership-form"><label className="membership-field">{L.email}<input type="email" autoComplete="username" required value={credentials.email} onChange={e=>setCredentials({...credentials,email:e.target.value})}/></label><label className="membership-field">{L.password}<input type="password" autoComplete="current-password" required value={credentials.password} onChange={e=>setCredentials({...credentials,password:e.target.value})}/></label><button className="membership-primary" disabled={busy}>{L.login}</button></form></section>:<>
            <div className="membership-admin-tools"><label>{ar?'الحالة':'Status'}<select value={filter} onChange={e=>setFilter(e.target.value)}>{['submitted','under_review','needs_information','approved','rejected','suspended','draft','all'].map(status=><option key={status} value={status}>{status==='all'?(ar?'جميع الحالات':'All statuses'):L[status]}</option>)}</select></label><label>{ar?'البحث في النتائج':'Search these results'}<input type="search" value={search} onChange={e=>setSearch(e.target.value)} maxLength={160}/></label><button onClick={()=>void reload()}><RefreshCw size={16}/>{L.retry}</button><button onClick={async()=>{try{await supportRequest('/logout',{staff:true,auth:true,method:'POST'});sessionStorage.removeItem(STAFF_TOKEN_KEY);setAuthenticated(false);setDetail(null);setRows([]);}catch(e){denied(e);}}}>{L.logout}</button></div>
            {hasMore&&<p>{ar?'تُعرض أحدث 100 نتيجة. استخدم مرشح الحالة لتضييق النتائج.':'Showing the latest 100 results. Use the status filter to narrow results.'}</p>}
            <div className="membership-admin-layout"><aside className="membership-admin-list">{!visible.length&&<p>{ar?'لا توجد طلبات بهذه الحالة.':'No applications with this status.'}</p>}{visible.map(app=><button key={app.reference} onClick={()=>setSelected(app.reference)} className={selected===app.reference?'selected':''}><strong>{app.applicant?.name||'—'}</strong><span dir="ltr">{app.applicant?.email}</span><small>{L[app.status]}</small><time>{date(app.submittedAt)}</time></button>)}</aside><section className="membership-panel membership-admin-detail">
                {!detail?<p>{selected?L.working:ar?'اختر طلبًا لبدء المراجعة.':'Select an application to begin.'}</p>:<><div className="membership-admin-status"><ShieldCheck size={22}/><h2>{L[row.status]}</h2></div><h3>{detail.applicant?.name}</h3><dl><dt>{L.email}</dt><dd dir="ltr">{detail.applicant?.email}</dd><dt>{L.phone}</dt><dd dir="ltr">{detail.applicant?.phone||'—'}</dd><dt>{L.reference}</dt><dd dir="ltr">{row.reference}</dd><dt>{L.eligibility}</dt><dd>{row.grandfathered?(ar?'حساب سابق مقبول':'Existing approved account'):row.category==='gcc_citizen'?L.gcc:L.professional}</dd><dt>{L.nationality}</dt><dd>{row.nationality?new Intl.DisplayNames([language],{type:'region'}).of(row.nationality.toUpperCase()):'—'}</dd>{row.profession&&<><dt>{L.profession}</dt><dd>{L[row.profession]} · {row.professionTitle}</dd></>}</dl>
                    <div className="membership-admin-documents">{row.documents.map(doc=><button key={doc.kind} onClick={()=>setDocument(doc.kind)}><FileImage size={19}/>{L[doc.kind]}<span>↗</span></button>)}</div>
                    {row.documentsDeleteAt&&<p className="membership-private-note">{ar?'موعد حذف صور الوثائق: ':'Document deletion date: '}{date(row.documentsDeleteAt)}</p>}
                    {row.publicNote&&<p className="membership-notebox">{row.publicNote}</p>}
                    {(reviewable||row.status==='approved'||row.status==='suspended')&&<div className="membership-admin-review"><label className="membership-field">{ar?'ملاحظة تظهر للعميل في حسابه وبريده':'Note visible to the applicant in their account and email'}<textarea maxLength={1000} rows={3} value={note} onChange={e=>setNote(e.target.value)}/></label>{reviewable&&<label className="membership-consent"><input type="checkbox" checked={verified} onChange={e=>setVerified(e.target.checked)}/><span>{ar?'راجعت الوثائق وتطابق الاسم والجنسية، والإقامة والمهنة للفئة المهنية.':'I reviewed the documents and verified the name and citizenship, and UAE residence and occupation for professional applicants.'}</span></label>}<div className="membership-admin-actions">{row.status==='submitted'&&<button disabled={busy} onClick={()=>void review('start_review')}>{ar?'بدء المراجعة':'Start review'}</button>}{reviewable&&<><button className="membership-primary" disabled={busy||!verified||!row.documents.length} onClick={()=>void review('approve')}><Check size={16}/>{ar?'قبول العضوية':'Approve membership'}</button><button disabled={busy||note.trim().length<5} onClick={()=>void review('reject')}>{ar?'رفض الطلب':'Decline application'}</button></>}{['submitted','under_review','suspended'].includes(row.status)&&<button disabled={busy||note.trim().length<5} onClick={()=>void review('request_information')}>{ar?'طلب استكمال معلومات':'Request information'}</button>}{row.status==='approved'&&<button disabled={busy||note.trim().length<5} onClick={()=>void review('suspend')}>{ar?'تعليق العضوية':'Suspend membership'}</button>}</div></div>}
                    <section className="membership-admin-history"><h3>{ar?'الإشعارات وسجل المراجعة':'Notifications and review history'}</h3>{detail.notifications?.map(n=><p key={`${n.event}-${n.createdAt}`}>{L[n.event]||n.event} · {({sent:ar?'أُرسل':'Sent',pending:ar?'بانتظار الإرسال':'Queued',sending:ar?'جارٍ الإرسال':'Sending',unknown:ar?'تسليم غير مؤكد؛ تحقق قبل إعادة الإرسال':'Delivery uncertain; check before resending',superseded:ar?'استُبدل بتحديث أحدث':'Superseded'})[n.status]||n.status}</p>)}{detail.events.map((event,i)=><p key={i}><time>{date(event.at)}</time><span>{L[event.event]||event.event}{event.kind?` · ${L[event.kind]}`:''}</span></p>)}</section>
                </>}
            </section></div>
        </>}{document&&detail&&<DocumentViewer reference={selected} kind={document} close={()=>setDocument('')} L={L}/>}</MembershipChrome>;
}
