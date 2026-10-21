import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useLanguage} from '../i18n';
import {membershipRequest} from '../services/membershipApi';
import {membershipCopy} from '../services/membershipCopy';
import MembershipPortal,{MembershipChrome} from '../pages/MembershipPortal';
const MembershipAdmin=lazy(()=>import('../pages/MembershipAdmin'));
const CustomerSupport=lazy(()=>import('../pages/CustomerSupport'));
const LegalPage=lazy(()=>import('../pages/LegalPage'));
const AccountCenter=lazy(()=>import('./AccountCenter'));
const PaymentStatus=lazy(()=>import('../pages/PaymentStatus'));

export default function MembershipBoundary({children}){
    const {language}=useLanguage(),L=membershipCopy(language);
    const [snapshot,setSnapshot]=useState(null),[error,setError]=useState(false),[pathname,setPathname]=useState(location.pathname);
    const sequence=useRef(0),active=useRef(true);
    const refresh=useCallback(async()=>{
        const attempt=++sequence.current;
        try{
            const data=await membershipRequest('/status');
            if(data.enabled!==false&&(data.enabled!==true||typeof data.authenticated!=='boolean'||typeof data.canAccess!=='boolean'||data.canAccess&&(!data.authenticated||data.application?.status!=='approved')))throw Error('invalid_membership_status');
            if(active.current&&attempt===sequence.current){setSnapshot({...data,checkedAt:new Date()});setError(false);}
        }catch{if(active.current&&attempt===sequence.current){setSnapshot(null);setError(true);}}
    },[]);
    const go=useCallback(path=>{history.pushState({},'',path);setPathname(location.pathname);window.scrollTo({top:0,behavior:'instant'});},[]);
    useEffect(()=>{
        active.current=true;void refresh();
        const changed=()=>{void refresh();},pop=()=>setPathname(location.pathname);
        const timer=setInterval(()=>{if(!document.hidden)void refresh();},8000);
        window.addEventListener('popstate',pop);window.addEventListener('remal:user-changed',changed);window.addEventListener('remal:membership-required',changed);document.addEventListener('visibilitychange',changed);
        return()=>{active.current=false;++sequence.current;clearInterval(timer);window.removeEventListener('popstate',pop);window.removeEventListener('remal:user-changed',changed);window.removeEventListener('remal:membership-required',changed);document.removeEventListener('visibilitychange',changed);};
    },[refresh]);
    // Public service and legal pages do not mount inventory/search hooks.
    if(pathname==='/membership-admin')return <Suspense><MembershipAdmin/></Suspense>;
    if(pathname==='/customer-service')return <Suspense><CustomerSupport staff/></Suspense>;
    if(['/privacy','/terms'].includes(pathname))return <Suspense><LegalPage kind={pathname.slice(1)}/></Suspense>;
    if(pathname==='/support')return <Suspense><CustomerSupport/></Suspense>;
    if(error||!snapshot)return <MembershipChrome compact><section className="membership-panel" style={{maxWidth:520,margin:'60px auto'}} role={error?'alert':'status'}><h1>{error?L.unavailable:L.working}</h1>{error&&<button className="membership-primary" onClick={()=>void refresh()}>{L.retry}</button>}</section></MembershipChrome>;
    if(snapshot.enabled===false)return children;
    if(snapshot.authenticated&&pathname==='/bookings'&&!snapshot.canAccess)return <MembershipChrome compact><Suspense><AccountCenter bookingsOnly onNavigate={go}/></Suspense></MembershipChrome>;
    if(pathname==='/payment-status')return <MembershipChrome compact><Suspense><PaymentStatus onBack={()=>go('/')}/></Suspense></MembershipChrome>;
    if(snapshot.canAccess&&pathname!=='/membership')return children;
    return <MembershipPortal snapshot={snapshot} refresh={refresh} go={go}/>;
}
