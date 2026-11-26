import {lazy,Suspense,useCallback,useEffect,useRef,useState} from 'react';
import {useLanguage} from '../i18n';
import {membershipRequest} from '../services/membershipApi';
import {membershipCopy} from '../services/membershipCopy';
import { MemberIdentity } from './SavedStays';
import PillowWait from './PillowWait';
import MembershipPortal,{MembershipChrome} from '../pages/MembershipPortal';
import {knownRoute,pageTitle} from '../services/pageRoutes';
const NotFound=lazy(()=>import('../pages/NotFound'));
const MembershipAdmin=lazy(()=>import('../pages/MembershipAdmin'));
const CustomerSupport=lazy(()=>import('../pages/CustomerSupport'));
const AccountDeletion=lazy(()=>import('../pages/AccountDeletion'));
const AccountDeletionRequests=lazy(()=>import('./AccountDeletionRequests'));
const LegalPage=lazy(()=>import('../pages/LegalPage'));
const AccountCenter=lazy(()=>import('./AccountCenter'));
const MEMBER_RETURN='pillow.memberReturn';
function safeMemberReturn(url=location) {
    if(/^\/hotel\/[^/]+$/.test(url.pathname))return url.pathname+url.search;
    if(['/bookings','/favorites','/account','/checkout','/notifications'].includes(url.pathname))return url.pathname + (url.pathname==='/account'?url.search:'');
    return null;
}
const Checkout=lazy(()=>import('../Checkout'));
const MemberNotifications=lazy(()=>import('../pages/MemberNotifications'));
const PaymentStatus=lazy(()=>import('../pages/PaymentStatus'));
const pageWait=<main className="pillow-wait-page"><PillowWait /></main>;

export default function MembershipBoundary({children}){
    const {language,t}=useLanguage(),L=membershipCopy(language);
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
        const changed=()=>{void refresh();},sessionChanged=()=>{setSnapshot(null);void refresh();},pop=()=>setPathname(location.pathname);
        const timer=setInterval(()=>{if(!document.hidden)void refresh();},8000);
        window.addEventListener('popstate',pop);window.addEventListener('remal:user-changed',sessionChanged);window.addEventListener('remal:membership-required',changed);document.addEventListener('visibilitychange',changed);
        return()=>{active.current=false;++sequence.current;clearInterval(timer);window.removeEventListener('popstate',pop);window.removeEventListener('remal:user-changed',sessionChanged);window.removeEventListener('remal:membership-required',changed);document.removeEventListener('visibilitychange',changed);};
    },[refresh]);
    useEffect(()=>{
        if(!snapshot || snapshot.canAccess || snapshot.enabled!==true)return;
        const target=safeMemberReturn();
        if(target){try{sessionStorage.setItem(MEMBER_RETURN,target);}catch{}}
    },[snapshot,pathname]);
    const enter=()=>{
        let path='/';
        try{
            const saved=sessionStorage.getItem(MEMBER_RETURN);sessionStorage.removeItem(MEMBER_RETURN);
            if(saved){const url=new URL(saved,location.origin);if(url.origin===location.origin)path=safeMemberReturn(url)||'/';}
        }catch{}
        go(path);
    };
    // Each page names itself in the browser tab; an address the site does not have gets a real "not found" page.
    useEffect(()=>{if(!/^\/hotel\//.test(pathname))document.title=pageTitle(pathname,language)||t('meta.title','مخدة | pillow stays');},[pathname,language,t]);
    if(!knownRoute(pathname))return <Suspense fallback={pageWait}><NotFound go={go}/></Suspense>;
    // Public service and legal pages do not mount inventory/search hooks.
    if(pathname==='/membership-admin')return <Suspense fallback={pageWait}><MembershipAdmin/></Suspense>;
    if(pathname==='/customer-service')return <Suspense fallback={pageWait}><CustomerSupport staff/></Suspense>;
    if(['/privacy','/terms'].includes(pathname))return <Suspense fallback={pageWait}><LegalPage kind={pathname.slice(1)}/></Suspense>;
    if(pathname==='/account-deletion')return <Suspense fallback={pageWait}><AccountDeletion/></Suspense>;
    if(pathname==='/account-deletion-requests')return <Suspense fallback={pageWait}><AccountDeletionRequests/></Suspense>;
    if(pathname==='/support')return <Suspense fallback={pageWait}><CustomerSupport/></Suspense>;
    const callbackQuery = new URLSearchParams(location.search);
    if(pathname==='/checkout' && callbackQuery.has('ref') && (callbackQuery.has('payment') || callbackQuery.has('affiliate')))return <MembershipChrome compact><Suspense fallback={<PillowWait />}><Checkout onBack={()=>go('/bookings')}/></Suspense></MembershipChrome>;
    if(pathname==='/payment-status')return <MembershipChrome compact><Suspense fallback={<PillowWait />}><PaymentStatus onBack={()=>go('/')}/></Suspense></MembershipChrome>;
    if(error)return <MembershipChrome compact><section className="membership-panel" style={{maxWidth:520,margin:'60px auto'}} role="alert"><h1>{L.unavailable}</h1><button className="membership-primary" onClick={()=>void refresh()}>{L.retry}</button></section></MembershipChrome>;
    if(!snapshot)return <main className="pillow-wait-page"><PillowWait stage="membership" /></main>;
    if(pathname==='/notifications' && snapshot.authenticated && !snapshot.canAccess)return <MembershipChrome compact><Suspense fallback={<PillowWait />}><MemberNotifications /></Suspense></MembershipChrome>;
    if(snapshot.enabled===false)return <MembershipPortal snapshot={{...snapshot,authenticated:false,canAccess:false}} refresh={refresh} go={go}/>;
    if(snapshot.authenticated&&pathname==='/bookings'&&!snapshot.canAccess)return <MembershipChrome compact><Suspense fallback={<PillowWait />}><AccountCenter bookingsOnly onNavigate={go}/></Suspense></MembershipChrome>;

    if(snapshot.canAccess&&pathname!=='/membership')return <MemberIdentity.Provider value={snapshot.user}>{children}</MemberIdentity.Provider>;
    return <MembershipPortal snapshot={snapshot} refresh={refresh} go={go} onEnter={enter}/>;
}
