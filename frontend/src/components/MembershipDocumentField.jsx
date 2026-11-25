import { useEffect, useState } from 'react';
import { Check, FileImage } from 'lucide-react';
import { membershipDocument } from '../services/membershipApi';
import { useLanguage } from '../i18n';
const words={ar:['رفع الصورة','إلغاء اختيار الصورة','معاينة المستند المرفوع','إزالة المستند المرفوع','تعذّرت معاينة المستند'],en:['Upload image','Discard selection','Preview uploaded document','Remove uploaded document','Could not preview the document'],es:['Subir imagen','Descartar selección','Ver documento','Eliminar documento','No se pudo mostrar el documento']};
export default function MembershipDocumentField({kind,uploaded,reference,busy,L,save,onDirty}) {
    const {language}=useLanguage(),T=words[language]||words.en;
    const [file,setFile]=useState(null),[preview,setPreview]=useState(''),[remote,setRemote]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false);
    const blob=file||remote;
    useEffect(()=>{if(!blob){setPreview('');return;}const url=URL.createObjectURL(blob);setPreview(url);return()=>URL.revokeObjectURL(url);},[blob]);
    const select=value=>{
        setError('');setRemote(null);
        if(value && (!['image/jpeg','image/png'].includes(value.type)||value.size<=0||value.size>5*1024*1024)){setError(L.invalidFile);return;}
        setFile(value);onDirty(kind,Boolean(value));
    };
    const submit=async value=>{
        setError('');try{await save(kind,value);select(null);}catch(e){setError(e.message);}
    };
    return <div className="pillow-document-field">
        <label className={'membership-upload ' + (uploaded?'uploaded':'')}><span className="membership-uploadicon">{uploaded?<Check size={22}/>:<FileImage size={22}/>}</span>
            <span><strong>{L[kind]}</strong><small>{uploaded?L.uploaded:L.fileHint}</small><b>{uploaded?L.replace:L.selectFile}</b></span>
            <input type="file" accept="image/jpeg,image/png" disabled={busy||loading} aria-label={L[kind]} onChange={event=>{const f=event.target.files?.[0];if(f)select(f);event.target.value='';}}/>
        </label>
        {preview&&<img alt={L[kind]} src={preview} />}
        {error&&<p role="alert" className="membership-error">{error}</p>}
        {file?<div><button type="button" disabled={busy} onClick={()=>void submit(file)}>{T[0]}</button><button type="button" disabled={busy} onClick={()=>select(null)}>{T[1]}</button></div>:
            uploaded&&<div><button type="button" disabled={busy||loading} onClick={async()=>{setError('');setLoading(true);try{setRemote(await membershipDocument(reference,kind));}catch{setError(T[4]);}finally{setLoading(false);}}}>{T[2]}</button>
            <button type="button" disabled={busy||loading} onClick={()=>void submit(null)}>{T[3]}</button></div>}
    </div>;
}
