import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import BookingAPI from '../services/bookingApi';
import { useLanguage } from '../i18n';
export default function BookingVoucherPreview({ reference, onClose }) {
    const { language,direction,t }=useLanguage();
    const frame=useRef(null),[html,setHtml]=useState(''),[failed,setFailed]=useState(false);
    const title=language==='ar'?'فاوجر الحجز':language==='es'?'Bono de reserva':'Booking voucher';
    useEffect(()=>{
        const dialog=frame.current,activeElement=document.activeElement;
        dialog.showModal();
        return ()=>{dialog.close();activeElement?.focus();};
    },[]);
    useEffect(()=>{
        const controller=new AbortController();
        setHtml('');setFailed(false);
        BookingAPI.getOwnedBookingVoucher(reference,language,'html',controller.signal).then(({data})=>{
            if(!controller.signal.aborted && typeof data==='string')setHtml(data);
        }).catch(()=>{if(!controller.signal.aborted)setFailed(true);});
        return ()=>controller.abort();
    },[reference,language]);
    return <dialog className="pillow-voucher-dialog" aria-labelledby="pillow-voucher-title" ref={frame} dir={direction} onCancel={e=>{e.preventDefault();onClose();}}>
        <header><h2 id="pillow-voucher-title">{title}</h2><button autoFocus type="button" className="pillow-icon" onClick={onClose} aria-label={t('search.close','إغلاق')}><X size={20}/></button></header>
        {failed?<p role="alert">{t('account.voucherUnavailable','تعذر تحميل القسيمة حالياً.')}</p>:html?<iframe title={title} sandbox="" referrerPolicy="no-referrer" srcDoc={html}/>:<p role="status">{t('search.loading','…')}</p>}
    </dialog>;
}
