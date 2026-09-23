import { ArrowLeft, Check, Wifi, Info, Coffee, Ban, AlertCircle } from 'lucide-react';
import { BedIcon, UsersIcon } from './Icons';
import PriceDisplay from './PriceDisplay';

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
    const payable = ['AED', 'USD', 'SAR', 'EUR'].includes(room.currency) && room.paymentType === 'deposit'
        && Number.isFinite(room.price) && room.price > 0 && room.book_hash;
    const additionalTaxes = (room.taxes || []).filter(tax => !tax.included_by_supplier);

    return (
        <article
            aria-labelledby={`room-${room.book_hash || room.roomId || room.name}`}
            className="group relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-all duration-300 hover:border-blue-200 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]"
        >
            <div className="min-w-0 p-1">
                <div className="rounded-2xl grid gap-8 p-5 sm:p-7 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-center bg-white">
                    
                    {/* Right Side: Room Details */}
                    <div className="min-w-0 text-right">
                        <h3 id={`room-${room.book_hash || room.roomId || room.name}`} className="text-2xl font-black leading-snug text-slate-900 mb-4 group-hover:text-blue-700 transition-colors">
                            {room.name || 'غرفة فندقية'}
                        </h3>
                        
                        {/* Masterstroke Badges for Amenities */}
                        <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-700">
                            {typeof room.bed === 'string' && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                                    <BedIcon size={16} className="text-slate-400" />
                                    {room.bed}
                                </span>
                            )}
                            
                            {room.guests && (
                                <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                                    <UsersIcon size={16} className="text-slate-400" />
                                    {room.guests.reduce((total, group) => total + group.adults + group.children.length, 0)} ضيوف
                                </span>
                            )}
                            
                            {room.meal && (
                                <span className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 border ${room.meal === 'nomeal' ? 'bg-slate-50 border-slate-100 text-slate-600' : 'bg-orange-50 border-orange-100 text-orange-800'}`}>
                                    {room.meal === 'nomeal' ? <Ban size={15} className="text-slate-400" /> : <Coffee size={15} className="text-orange-500" />}
                                    {room.meal === 'nomeal' ? 'بدون وجبات' : room.meal === 'breakfast' ? 'الإفطار مشمول' : room.meal}
                                </span>
                            )}

                            {room.amenities?.slice(0, 1).map((amenity) => (
                                <span key={String(amenity)} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50/50 border border-blue-100 px-3 py-2 text-blue-800">
                                    <Wifi size={15} className="text-blue-600" />
                                    {amenity}
                                </span>
                            ))}
                        </div>
                        
                        <div className="mt-6">
                            <CancellationPolicy cancellation={room.cancellation} currency={room.currency} />
                        </div>
                    </div>

                    {/* Left Side: Pricing & CTA (Inside a highlighted box for better UX) */}
                    <div className="min-w-0 rounded-2xl bg-slate-50 p-6 text-start xl:p-6 border border-slate-100 relative overflow-hidden">
                        {/* Decorative background element */}
                        <div className="absolute top-0 left-0 w-32 h-32 bg-blue-600/5 rounded-full blur-3xl -translate-x-10 -translate-y-10" />
                        
                        <div aria-live="polite" aria-atomic="true" className="relative z-10">
                            <p className="text-sm font-bold text-slate-500 mb-1">السعر الإجمالي</p>
                            <PriceDisplay amount={room.price} currency={room.currency || 'USD'} displayCurrency={displayCurrency} displayRates={displayRates} className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl" />
                            <p className="mt-2 text-xs font-medium leading-relaxed text-slate-500">إجمالي الإقامة المحددة؛ قد تُطبق رسوم محلية في الفندق.</p>
                            
                            {additionalTaxes.length > 0 && (
                                <div className="mt-3 space-y-1 rounded-lg bg-orange-50/50 p-2 border border-orange-100/50">
                                    {additionalTaxes.map((tax, index) => (
                                        <p key={index} className="text-[11px] font-bold text-orange-800 flex justify-between">
                                            <span>رسوم غير مشمولة ({tax.name}):</span>
                                            <span dir="ltr">{tax.amount} {tax.currency_code}</span>
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                        
                        <div className="mt-5 relative z-10">
                            <button 
                                type="button" 
                                onClick={() => onBook?.(room)} 
                                disabled={!payable} 
                                className="group/btn relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-blue-600 px-6 py-3.5 font-black text-white shadow-[0_4px_14px_0_rgb(37,99,235,0.39)] transition-all duration-300 hover:bg-blue-700 hover:shadow-[0_6px_20px_rgba(37,99,235,0.23)] hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none disabled:hover:translate-y-0"
                            >
                                <span className="relative z-10 flex items-center gap-2">
                                    اختيار الغرفة <ArrowLeft size={18} className="transition-transform duration-300 group-hover/btn:-translate-x-1" />
                                </span>
                            </button>
                            {!payable && (
                                <div className="mt-3 flex items-start gap-1.5 text-xs font-bold text-red-600 bg-red-50 p-2 rounded-lg">
                                    <Info size={14} className="shrink-0 mt-0.5" />
                                    <p>عذراً، هذا العرض غير متاح للدفع الإلكتروني حالياً.</p>
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </article>
    );
}