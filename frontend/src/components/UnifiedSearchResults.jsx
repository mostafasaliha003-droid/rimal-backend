import { useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, BedDouble, CheckCircle2, Clock3, MapPin, RefreshCw, Search, ShieldCheck, Sparkles } from 'lucide-react';
import { useLanguage } from '../i18n';
import { canCreateHotelbedsCheckout, formatAedPrice, hotelbedsCheckoutUnavailableReason, validateUnifiedSearchResponse } from '../services/nextGenCheckout';

function SkeletonCard() {
    return (
        <article aria-hidden="true" className="glass-surface animate-pulse overflow-hidden rounded-3xl border border-white/70 p-5 shadow-float sm:p-6">
            <div className="flex gap-5">
                <div className="hidden h-32 w-40 shrink-0 rounded-2xl bg-slate-200/80 sm:block" />
                <div className="min-w-0 flex-1 space-y-4">
                    <div className="h-4 w-24 rounded-full bg-slate-200" />
                    <div className="h-7 w-2/3 rounded-lg bg-slate-200" />
                    <div className="h-4 w-1/3 rounded-lg bg-slate-100" />
                    <div className="flex justify-between gap-5 pt-3">
                        <div className="h-5 w-28 rounded-lg bg-slate-100" />
                        <div className="h-10 w-32 rounded-xl bg-slate-200" />
                    </div>
                </div>
            </div>
        </article>
    );
}

function SearchSkeleton({ label }) {
    return (
        <section role="status" aria-label={label} className="space-y-5">
            <span className="sr-only">{label}</span>
            {Array.from({ length: 3 }, (_, index) => <SkeletonCard key={index} />)}
        </section>
    );
}

function OfferCard({ offer, onChoose, labels }) {
    const amount = formatAedPrice(offer?.price?.amount, offer?.price?.currency);
    const canCheckout = Boolean(amount && canCreateHotelbedsCheckout(offer));
    const payAtProperty = offer.paymentFlow === 'PAY_AT_PROPERTY';
    const paymentFlowKnown = offer.paymentFlow === 'PAY_NOW' || payAtProperty;
    const refundable = offer.cancellation?.refundability;

    return (
        <article className="rounded-2xl border border-white/80 bg-white/65 p-4 shadow-sm backdrop-blur-xl transition hover:border-remal-blue/25 hover:bg-white/85 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h4 className="break-words text-base font-black text-remal-navy">{offer.room?.name || labels.room}</h4>
                    <p className="mt-2 flex items-center gap-2 text-sm font-semibold text-slate-600">
                        <BedDouble size={16} className="shrink-0 text-remal-blue" />
                        {offer.board?.normalizedCode && offer.board.normalizedCode !== 'UNKNOWN'
                            ? (offer.board.normalizedCode === 'BB' ? labels.breakfast : offer.board.normalizedCode)
                            : labels.roomOnly}
                    </p>
                    {offer.stay?.checkIn && offer.stay?.checkOut && (
                        <p className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-500">
                            <Clock3 size={14} /> {offer.stay.checkIn} — {offer.stay.checkOut}
                        </p>
                    )}
                </div>
                <div className="text-end">
                    <p className="text-xs font-bold text-slate-500">{labels.total}</p>
                    <p className="mt-1 text-xl font-black tabular-nums text-remal-navy" aria-label={amount || labels.priceUnavailable}>
                        {amount || labels.priceUnavailable}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-slate-500">{labels.serverPrice}</p>
                </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-remal-navy/5 pt-4">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black ${payAtProperty ? 'bg-emerald-50 text-emerald-800' : 'bg-cyan-50 text-cyan-900'}`}>
                    <ShieldCheck size={14} /> {payAtProperty ? labels.payAtProperty : offer.paymentFlow === 'PAY_NOW' ? labels.payNow : labels.paymentUnknown}
                </span>
                <span className="text-xs font-bold text-slate-500">{labels.refundability[refundable] || labels.policyVaries}</span>
                {canCheckout ? (
                    <button type="button" onClick={() => onChoose?.(offer)} className="cta-red inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black text-white">
                        {labels.choose} <ArrowRight size={16} />
                    </button>
                ) : payAtProperty || !paymentFlowKnown ? (
                    <span className="text-xs font-bold text-slate-500">{labels.checkoutUnavailable[hotelbedsCheckoutUnavailableReason(offer)] || labels.checkoutUnavailable.payment_flow_unsupported}</span>
                ) : (
                    <span className="text-xs font-bold text-slate-500">{labels.priceUnavailable}</span>
                )}
            </div>
        </article>
    );
}

function HotelCard({ hotel, onChooseOffer, labels }) {
    const offers = Array.isArray(hotel.offers) ? hotel.offers : [];
    const image = typeof hotel.images?.[0] === 'string' ? hotel.images[0] : null;
    const category = hotel.category?.name || hotel.category?.code;

    return (
        <article className="glass-surface overflow-hidden rounded-3xl border border-white/80 shadow-float">
            <div className="flex flex-col sm:flex-row">
                {image && <img src={image} alt="" loading="lazy" className="h-48 w-full object-cover sm:h-52 sm:w-56" />}
                <div className="min-w-0 flex-1 p-5 sm:p-6">
                    <p className="eyebrow flex items-center gap-2"><MapPin size={14} /> {hotel.destinationName || hotel.destinationCode || labels.hotel}</p>
                    <h3 className="mt-2 break-words text-2xl font-black text-remal-navy">{hotel.name || labels.hotel}</h3>
                    {category && <p className="mt-2 text-sm font-semibold text-slate-600">{category}</p>}
                    {hotel.hotelGroupId && <p className="mt-2 text-xs font-semibold text-slate-500">{labels.verifiedProperty}</p>}
                </div>
            </div>
            <div className="space-y-3 border-t border-remal-navy/5 bg-white/30 p-4 sm:p-5">
                {offers.length ? offers.map((offer, index) => (
                    <OfferCard key={offer.publicOfferId || `${hotel.hotelGroupId}-${index}`} offer={offer} onChoose={onChooseOffer} labels={labels} />
                )) : <p className="rounded-2xl bg-white/65 p-5 text-sm font-bold text-slate-600">{labels.noOffers}</p>}
            </div>
        </article>
    );
}

export default function UnifiedSearchResults({
    response,
    isLoading = false,
    error = '',
    onRetry,
    onChooseOffer,
    className = ''
}) {
    const { t, direction } = useLanguage();
    const [expandedHotels, setExpandedHotels] = useState(false);
    const labels = useMemo(() => ({
        loading: t('nextgen.loading', 'جار البحث عن عروض الإقامة...'),
        mockNotice: t('nextgen.mockNotice', 'بيانات توضيحية تجريبية فقط — ليست مخزونًا أو أسعارًا حية.'),
        heading: t('nextgen.heading', 'عروض الفنادق المناسبة لرحلتك'),
        hotel: t('nextgen.hotel', 'فندق'),
        room: t('nextgen.room', 'غرفة'),
        total: t('nextgen.total', 'إجمالي الإقامة'),
        serverPrice: t('nextgen.serverPrice', 'السعر النهائي من الخادم · AED'),
        priceUnavailable: t('nextgen.priceUnavailable', 'السعر غير متاح'),
        payNow: t('nextgen.payNow', 'الدفع الآن'),
        payAtProperty: t('nextgen.payAtProperty', 'الدفع في مكان الإقامة'),
        paymentUnknown: t('nextgen.paymentUnknown', 'طريقة الدفع غير معروفة'),
        choose: t('nextgen.choose', 'اختيار العرض'),
        checkoutUnavailable: {
            payment_flow_unsupported: t('nextgen.checkoutUnavailable', 'الدفع المسبق غير متاح لهذا العرض'),
            occupancy_unsupported: t('nextgen.occupancyUnavailable', 'الدفع التجريبي يدعم غرفة واحدة للبالغين فقط')
        },
        verifiedProperty: t('nextgen.verifiedProperty', 'عروض موحدة للعقار الموثّق فقط'),
        breakfast: t('nextgen.breakfast', 'يشمل الإفطار'),
        roomOnly: t('nextgen.roomOnly', 'غرفة فقط'),
        policyVaries: t('nextgen.policyVaries', 'تختلف شروط الإلغاء'),
        noOffers: t('nextgen.noOffers', 'لا توجد عروض صالحة لهذا الفندق.'),
        emptyTitle: t('nextgen.emptyTitle', 'لم نعثر على عروض لهذه الرحلة'),
        emptyBody: t('nextgen.emptyBody', 'جرّب تغيير التواريخ أو الوجهة ثم أعد البحث.'),
        errorTitle: t('nextgen.errorTitle', 'تعذر تحميل العروض'),
        retry: t('nextgen.retry', 'إعادة المحاولة'),
        partial: t('nextgen.partial', 'تظهر النتائج المتاحة الآن؛ تعذر إكمال بعض مصادر الأسعار.'),
        showMore: t('nextgen.showMore', 'عرض المزيد من الفنادق'),
        refundability: {
            conditional: t('nextgen.conditional', 'إلغاء بشروط'),
            non_refundable: t('nextgen.nonRefundable', 'غير قابل للاسترداد'),
            refundable: t('nextgen.refundable', 'قابل للاسترداد'),
            unknown: t('nextgen.unknownRefund', 'تحقق من سياسة الإلغاء')
        }
    }), [t]);

    let normalized;
    let invalidResponse = false;
    if (response !== null && response !== undefined) {
        try { normalized = validateUnifiedSearchResponse(response); }
        catch { invalidResponse = true; }
    }

    if (isLoading) return <SearchSkeleton label={labels.loading} />;
    if (error || invalidResponse) {
        return (
            <section role="alert" dir={direction} className={`glass-surface rounded-3xl border border-red-200/80 p-8 text-center shadow-float sm:p-12 ${className}`}>
                <AlertCircle size={38} className="mx-auto text-remal-danger" />
                <h2 className="mt-4 text-2xl font-black text-remal-navy">{labels.errorTitle}</h2>
                <p className="mt-2 text-sm font-semibold text-slate-600">{invalidResponse ? labels.errorTitle : error}</p>
                {onRetry && <button type="button" onClick={onRetry} className="cta-red mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-2.5 font-black text-white"><RefreshCw size={16} />{labels.retry}</button>}
            </section>
        );
    }
    if (!normalized) return null;

    const hotels = normalized.hotels.filter(hotel => hotel && Array.isArray(hotel.offers));
    if (!hotels.length) {
        return (
            <section dir={direction} className={`glass-surface rounded-3xl border border-white/80 px-6 py-12 text-center shadow-float sm:px-12 ${className}`}>
                <Search size={40} className="mx-auto text-remal-blue" />
                <h2 className="mt-4 text-2xl font-black text-remal-navy">{labels.emptyTitle}</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm font-semibold leading-6 text-slate-600">{labels.emptyBody}</p>
            </section>
        );
    }

    const visibleHotels = expandedHotels ? hotels : hotels.slice(0, 12);
    return (
        <section dir={direction} className={`space-y-5 ${className}`}>
            <header className="glass-light flex flex-wrap items-end justify-between gap-4 rounded-3xl border border-white/80 p-5 shadow-sm backdrop-blur-xl sm:p-6">
                <div>
                    <p className="eyebrow flex items-center gap-2"><Sparkles size={14} />{labels.heading}</p>
                    <h2 className="mt-2 text-2xl font-black text-remal-navy sm:text-3xl">{hotels.length} {labels.hotel}</h2>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-3 py-2 text-xs font-black text-emerald-900">
                    <CheckCircle2 size={15} /> AED · {normalized.offerCount ?? hotels.reduce((total, hotel) => total + hotel.offers.length, 0)} {labels.total}
                </div>
            </header>
            {normalized.mock === true && <p role="note" className="rounded-2xl border border-cyan-200/70 bg-cyan-50/80 p-4 text-sm font-black text-cyan-950">{labels.mockNotice}</p>}
            {normalized.partialResults && <p role="status" className="flex items-start gap-2 rounded-2xl border border-amber-200/70 bg-amber-50/75 p-4 text-sm font-bold text-amber-950 backdrop-blur-xl"><AlertCircle size={18} className="mt-0.5 shrink-0" />{labels.partial}</p>}
            <div className="space-y-5">
                {visibleHotels.map((hotel, index) => <HotelCard key={hotel.hotelGroupId || `${hotel.name}-${index}`} hotel={hotel} onChooseOffer={onChooseOffer} labels={labels} />)}
            </div>
            {!expandedHotels && hotels.length > visibleHotels.length && (
                <button type="button" onClick={() => setExpandedHotels(true)} className="glass-light min-h-12 w-full rounded-2xl border border-white/80 px-5 py-3 font-black text-remal-navy shadow-sm backdrop-blur-xl hover:bg-white/90">{labels.showMore}</button>
            )}
        </section>
    );
}