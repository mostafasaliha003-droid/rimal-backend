import { useState } from 'react';
import { ArrowLeft, Check, Wifi, Info, Coffee, Ban, AlertCircle } from 'lucide-react';
import { BedIcon, UsersIcon, StarIcon } from './Icons'; // تأكد أن StarIcon متوفر هنا
import PriceDisplay from './PriceDisplay';
import BookingAPI from '../services/bookingApi'; // تأكد من مسار API الخاص بك

export function CancellationPolicy({ cancellation, currency }) {
    const deadline = cancellation?.free_cancellation_before;
    return (
        <div className="text-sm">
            {deadline ? (
                <div className="inline-flex max-w-full items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs font-bold text-emerald-800">
                    <Check size={16} className="text-emerald-500 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words leading-tight">
                        إلغاء مجاني حتى <span className="font-black text-emerald-900">{deadline.replace('T', ' ')}</span>
                    </span>
                </div>
            ) : (
                <div className="inline-flex max-w-full items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600">
                    <AlertCircle size={16} className="text-slate-400 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words leading-tight">لا يوجد إلغاء مجاني مؤكد لهذا العرض</span>
                </div>
            )}
            
            {cancellation?.policies?.length > 0 && (
                <details className="mt-3 group">
                    <summary className="cursor-pointer text-xs font-bold text-blue-600 hover:text-blue-700 transition-colors outline-none flex items-center gap-1">
                        رسوم الإلغاء
                    </summary>
                    <ul className="mt-2 space-y-1.5 rounded-xl bg-slate-50 p-3 text-xs font-medium text-slate-600 border border-slate-100 shadow-sm">
                        {cancellation.policies.map((policy, index) => (
                            <li key={index} className="flex justify-between items-center border-b border-slate-200/50 last:border-0 pb-1.5 last:pb-0">
                                <span>
                                    {policy.start_at ? `من ${policy.start_at.replace('T', ' ')}` : 'قبل الموعد التالي'}
                                    {policy.end_at ? ` حتى ${policy.end_at.replace('T', ' ')}` : ''}
                                </span>
                                <span className="font-bold text-slate-800 text-left" dir="ltr">
                                    {policy.amount} {policy.currency_code || currency}
                                </span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}

export default function RoomCard({ room = {}, onBook, displayCurrency = 'USD', displayRates = null }) {
    const [status, setStatus] = useState('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [prebookResult, setPrebookResult] = useState(null);

    const hotel = room.hotel || {};
    const name = room.name || 'غرفة فندقية';
    const image = hotel.images?.[0] || hotel.image;
    const price = room.price ?? '-';
    const amenities = room.amenities || [];

    const payable = ['AED', 'USD', 'SAR', 'EUR'].includes(room.currency) && room.paymentType === 'deposit'
        && Number.isFinite(room.price) && room.price > 0 && room.book_hash;
    const additionalTaxes = (room.taxes || []).filter(tax => !tax.included_by_supplier);

    const handleBook = async () => {
        if (status === 'success') {
            onBook?.(prebookResult);
            return;
        }
        setStatus('loading');
        setErrorMsg('');
        try {
            const result = await BookingAPI.prebook(room.book_hash || room.roomId, 2);
            setPrebookResult(result);
            setStatus('success');
        } catch (requestError) {
            setStatus('error');
            const errorCode = requestError.response?.data?.error;
            setErrorMsg(requestError.response?.status === 409 || errorCode === 'RATE_NOT_FOUND' || errorCode === 'rate_not_found'
                ? 'عذراً، لقد تغير السعر أو التوفر، يرجى تحديث الصفحة'
                : errorCode === 'PREBOOK_TIMEOUT'
                    ? 'استغرق التحقق من السعر وقتاً أطول من المتوقع. يرجى المحاولة مرة أخرى.'
                    : 'تعذر تثبيت السعر، يرجى المحاولة مرة أخرى');
        }
    };

    return (
        <article
            aria-labelledby={`room-${room.book_hash || room.roomId || room.name}`}
            className="room-card surface-card group relative mb-6 overflow-hidden rounded-3xl transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan-200 hover:shadow-[0_18px_42px_rgba(15,35,55,0.12)]"
        >
            <div className="flex flex-col lg:flex-row h-full">
                
                {/* Optional Image Section (If hotel image is passed down) */}
                {image && (
                    <div className="relative w-full lg:w-[240px] shrink-0 overflow-hidden bg-slate-100 h-48 lg:h-auto">
                        <img 
                            src={image} 
                            alt={hotel.name || 'صورة الغرفة'} 
                            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" 
                            onError={(event) => { event.currentTarget.style.display = 'none'; }} 
                        />
                        <div className="absolute top-3 left-3 z-10">
                            <span className="rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-black text-[var(--remal-blue)] shadow-sm">عرض قابل للمقارنة</span>
                        </div>
                    </div>
                )}

                {/* Right Side: Room Details */}
                <div className="flex-1 p-5 sm:p-6 lg:p-7 min-w-0 flex flex-col justify-between">
                    <div>
                        <div className="mb-2 flex items-center gap-2">
                            {!image && <span className="rounded-full bg-cyan-50 border border-cyan-100 px-2.5 py-1 text-[10px] font-black text-[var(--remal-blue)]">عرض قابل للمقارنة</span>}
                            <div className="flex gap-0.5 text-amber-400">
                                {Array.from({ length: 5 }).map((_, index) => <StarIcon key={index} size={14} fill="currentColor" />)}
                            </div>
                        </div>
                        
                        <h3 id={`room-${room.book_hash || room.roomId || room.name}`} className="text-2xl font-black leading-snug text-slate-900 mb-4 group-hover:text-blue-700 transition-colors">
                            {name}
                        </h3>
                        
                        {/* Masterstroke Badges for Amenities */}
                        <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-700">
                            {room.bed && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                                    <BedIcon size={16} className="text-slate-400" />
                                    {room.bed}
                                </span>
                            )}
                            
                            {room.guests && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                                    <UsersIcon size={16} className="text-slate-400" />
                                    حتى {room.guests.reduce((total, group) => total + group.adults + group.children.length, 0)} ضيوف
                                </span>
                            )}
                            
                            {room.meal && (
                                <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 border ${room.meal === 'nomeal' ? 'bg-slate-50 border-slate-100 text-slate-600' : 'bg-orange-50 border-orange-100 text-orange-800'}`}>
                                    {room.meal === 'nomeal' ? <Ban size={15} className="text-slate-400" /> : <Coffee size={15} className="text-orange-500" />}
                                    {room.meal === 'nomeal' ? 'بدون وجبات' : room.meal === 'breakfast' ? 'الإفطار مشمول' : room.meal}
                                </span>
                            )}

                            {amenities.slice(0, 2).map((amenity) => (
                                <span key={String(amenity)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50/50 border border-blue-100 px-3 py-2 text-blue-800">
                                    <Wifi size={15} className="text-blue-600" />
                                    <span className="truncate max-w-[120px]">{amenity}</span>
                                </span>
                            ))}
                        </div>
                        
                        <div className="mt-5">
                            <CancellationPolicy cancellation={room.cancellation} currency={room.currency} />
                        </div>
                    </div>
                </div>

                {/* Left Side: Pricing & CTA (Glassmorphism highlight box) */}
                <div className="bg-slate-50 border-t lg:border-t-0 lg:border-r border-slate-100 p-6 sm:p-7 flex flex-col justify-center min-w-[280px] relative overflow-hidden">
                    {/* Decorative background element */}
                    <div className="absolute top-0 left-0 w-32 h-32 bg-blue-600/5 rounded-full blur-3xl -translate-x-10 -translate-y-10" />
                    
                    <div aria-live="polite" aria-atomic="true" className="relative z-10 text-right mb-6">
                        <div className="mb-3 inline-flex rounded-full bg-cyan-50 border border-cyan-100 px-3 py-1 text-[10px] font-black text-[var(--remal-blue)] w-fit">
                            تحقق من السعر والتوفر قبل الدفع
                        </div>
                        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">السعر الإجمالي</p>
                        
                        <div className="flex items-baseline justify-end gap-1.5">
                            {price !== '-' ? (
                                <PriceDisplay amount={price} currency={room.currency || 'AED'} displayCurrency={displayCurrency} displayRates={displayRates} className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl" />
                            ) : (
                                <span className="text-3xl font-black tracking-tight text-slate-900">-</span>
                            )}
                        </div>
                        <p className="mt-1 text-xs font-semibold text-slate-500 flex items-center justify-end gap-1">
                            <Info size={12} /> شامل الضرائب والرسوم
                        </p>

                        {additionalTaxes.length > 0 && (
                            <div className="mt-3 space-y-1 rounded-lg bg-orange-50/50 p-2.5 border border-orange-100/50 text-right">
                                {additionalTaxes.map((tax, index) => (
                                    <p key={index} className="text-[11px] font-bold text-orange-800 flex justify-between items-center gap-2">
                                        <span>{tax.name || 'رسوم غير مشمولة'}{' '}</span>
                                        <span dir="ltr" className="bg-white px-1.5 py-0.5 rounded shadow-sm">{tax.amount} {tax.currency_code}</span>
                                    </p>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="relative z-10 flex flex-col gap-2">
                        {errorMsg && <p role="alert" className="text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg text-center border border-red-100 mb-2">{errorMsg}</p>}
                        
                        <button
                            type="button"
                            onClick={handleBook} 
                            disabled={status === 'loading' || (!payable && status !== 'success')} 
                            className={`group/btn relative inline-flex min-h-[56px] w-full items-center justify-center gap-2 overflow-hidden rounded-xl px-6 py-3.5 text-sm font-black text-white shadow-[0_8px_18px_rgba(232,117,45,0.25)] transition-all duration-300 hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:shadow-none disabled:hover:translate-y-0 ${status === 'success' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-[var(--remal-orange)] hover:bg-[#d86522]'} ${!payable && status !== 'success' ? 'bg-slate-300' : ''}`}
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                {status === 'loading' ? 'جارٍ التحقق...' : status === 'success' ? 'تم تثبيت السعر' : 'احجز الغرفة'}
                                {status === 'success' ? <Check size={18} className="animate-in zoom-in duration-300" /> : status === 'loading' ? <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin"></span> : <ArrowLeft size={18} className="transition-transform duration-300 group-hover/btn:-translate-x-1" />}
                            </span>
                        </button>

                        {!payable && status !== 'success' && (
                            <div className="mt-2 flex items-start gap-1.5 text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg">
                                <Info size={14} className="shrink-0 mt-0.5" />
                                <p>عذراً، هذا العرض غير متاح للدفع الإلكتروني حالياً.</p>
                            </div>
                        )}
                    </div>
                </div>

            </div>
        </article>
    );
}
