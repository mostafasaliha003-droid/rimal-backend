import { useEffect, useRef, useState } from 'react';
import { Download, FileText, LoaderCircle, X } from 'lucide-react';
import { supportDocument } from '../services/customerSupport';
export default function SupportDocumentViewer({ document, context, conversationId, staff, L, direction, onClose }) {
    const dialog = useRef(null), [url, setUrl] = useState(''), [failed, setFailed] = useState(false);
    const title = document === 'voucher' ? L.voucherPdf : L.cancellationPdf;
    useEffect(() => { const node = dialog.current; const prior = window.document.body.style.overflow;
        window.document.body.style.overflow = 'hidden'; node.showModal();
        return () => { node.close(); window.document.body.style.overflow = prior; };
    }, []);
    useEffect(() => {
        let active = true, objectUrl; const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        supportDocument({ conversationId, reference: context.reference, kind: document, staff, signal: controller.signal })
            .then(blob => { if (active) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); } })
            .catch(() => { if (active) setFailed(true); }).finally(() => clearTimeout(timer));
        return () => { active = false; clearTimeout(timer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [document, conversationId]);
    return <dialog data-support-document ref={dialog} dir={direction} onCancel={onClose} aria-labelledby="support-document-title" className="support-document-viewer">
        <header><div><FileText size={21} /><h2 id="support-document-title">{title}</h2></div><button autoFocus onClick={onClose} aria-label={L.close}><X size={22} /></button></header>
        <p className="support-reference" dir="ltr">{context.reference}</p>
        {failed ? <div role="alert" className="support-document-empty"><FileText size={38} /><p>{L.pdfError}</p></div>
            : !url ? <div role="status" className="support-document-empty"><LoaderCircle className="motion-safe:animate-spin" size={30} /><p>{L.pdfLoading}</p></div>
                : <><iframe data-support-pdf title={title} src={url} /><footer><span>{L.pdfHint}</span><a data-support-download href={url} download={`Remal-${document}-${context.reference}.pdf`}><Download size={17} />{L.download}</a></footer></>}
    </dialog>;
}
