import { useState } from 'react';
import CheckoutFlow from '../components/CheckoutFlow';
import { canCreateHotelbedsCheckout } from '../services/nextGenCheckout';
import { useLanguage } from '../i18n';

export default function NextGenCheckout({ onBack }) {
    const { t, direction } = useLanguage();
    const [offer] = useState(() => {
        try {
            const selected = JSON.parse(sessionStorage.getItem('remal_nextgen_selected_offer') || 'null');
            return selected?.mock === true && canCreateHotelbedsCheckout(selected) ? selected : null;
        } catch { return null; }
    });

    if (offer) return <CheckoutFlow offer={offer} onBack={onBack} />;
    return (
        <main dir={direction} className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-remal-bg px-5 py-10">
            <section role="alert" className="glass-surface max-w-xl rounded-3xl border border-white/80 p-8 text-center shadow-float">
                <h1 className="text-2xl font-black text-remal-navy">{t('nextgen.noSelectedOffer', 'انتهت صلاحية العرض أو لم يعد متاحًا.')}</h1>
                <p className="mt-3 text-sm font-semibold text-slate-600">{t('nextgen.returnSearch', 'ارجع إلى نتائج البحث واختر عرضًا تجريبيًا جديدًا.')}</p>
                {onBack && <button type="button" onClick={onBack} className="cta-red mt-6 min-h-11 rounded-xl px-5 py-2.5 font-black text-white">{t('nextgen.backOffers', 'العودة للعروض')}</button>}
            </section>
        </main>
    );
}