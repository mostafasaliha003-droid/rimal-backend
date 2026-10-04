import { AlertCircle } from 'lucide-react';

export function FieldError({ field, message }) {
    return message ? <p id={`search-${field}-error`} className="mt-2 flex items-start gap-1.5 text-sm font-semibold text-remal-danger">
        <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{message}</span>
    </p> : null;
}

export default function SearchFeedback({ controller }) {
    const { t, errors, suggestionStatus, suggestionMessage, searchError, online, busy, retrySuggestions } = controller;
    const error = Object.values(errors)[0] || searchError;
    const offline = t('search.offline', 'أنت غير متصل. احتفظنا ببيانات البحث؛ اتصل بالإنترنت ثم أعد المحاولة.');
    const notice = !online ? offline : ['error', 'empty'].includes(suggestionStatus) ? suggestionMessage : '';
    const messages = [...new Set([notice, error].filter(Boolean))];
    return <>
        <p id="search-status" role="status" aria-live="polite" aria-atomic="true" className="sr-only">
            {busy ? t('search.submitting', 'جارٍ البحث عن الفنادق...') : messages.join(' ') || suggestionMessage}
        </p>
        {(error || notice) && <div id="search-error" className="mt-3 flex flex-wrap items-start gap-2 rounded-xl border border-remal-danger/20 bg-white p-3 text-sm text-remal-danger">
            <AlertCircle size={18} className="shrink-0" aria-hidden="true" /><div className="min-w-0 flex-1 space-y-1">{messages.map(message => <p key={message}>{message}</p>)}</div>
            {online && suggestionStatus === 'error' && <button type="button" onClick={retrySuggestions} className="min-h-10 rounded-lg px-3 font-bold underline">{t('search.retry', 'إعادة المحاولة')}</button>}
        </div>}
    </>;
}