import { ArrowLeft, Check, Wifi } from 'lucide-react';
import { BedIcon, UsersIcon } from './Icons';
import PriceDisplay from './PriceDisplay';

export function CancellationPolicy({ cancellation, currency }) {
    const deadline = cancellation?.free_cancellation_before;
    return <div className="text-sm leading-7">
        {deadline ? (
            <span className="inline-flex max-w-full items-start gap-1.5 rounded-2xl bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 sm:rounded-full">
                <Check size={14} className="mt-0.5 shrink-0" aria-hidden="true" /><span className="min-w-0 break-words">إلغاء مجاني حتى {deadline.replace('T', ' ')} (بتوقيت المورد)</span>
            </span>
        ) : (
            <p className="text-slate-700">لا يوجد إلغاء مجاني مؤكد لهذا العرض</p>
        )}
        {cancellation?.policies?.length > 0 && <details className="mt-2"><summary className="cursor-pointer text-remal-blue">رسوم الإلغاء</summary><ul>{cancellation.policies.map((policy, index) => <li key={index}>{policy.start_at ? `من ${policy.start_at.replace('T', ' ')}` : 'قبل الموعد التالي'}{policy.end_at ? ` حتى ${policy.end_at.replace('T', ' ')}` : ''}: {policy.amount} {policy.currency_code || currency}</li>)}</ul></details>}
    </div>;
}

export default function RoomCard({ room = {}, onBook, displayCurrency = 'USD', displayRates = null }) {
    const payable = ['AED', 'USD', 'SAR', 'EUR'].includes(room.currency) && room.paymentType === 'deposit'
        && Number.isFinite(room.price) && room.price > 0 && room.book_hash;
    const additionalTaxes = (room.taxes || []).filter(tax => !tax.included_by_supplier);

    return (
        <article
            aria-labelledby={`room-${room.book_hash || room.roomId || room.name}`}
            className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_10px_rgb(0,0,0,0.04)] transition-shadow duration-300 hover:shadow-xl"
        >
            <div className="min-w-0">
                <div className="grid gap-6 p-6 sm:p-7 xl:grid-cols-[minmax(0,1fr)_16rem] xl:items-center">
                    <div className="min-w-0 text-right">
                        <h3 id={`room-${room.book_hash || room.roomId || room.name}`} className="text-xl font-black leading-8 text-slate-900">{room.name || 'غرفة فندقية'}</h3>
                        <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3 text-xs font-bold text-slate-600">
                            {typeof room.bed === 'string' && <span className="inline-flex items-center gap-2"><BedIcon size={17} />{room.bed}</span>}
                            {room.guests && <span className="inline-flex items-center gap-2"><UsersIcon size={17} />{room.guests.reduce((total, group) => total + group.adults + group.children.length, 0)} ضيوف حسب البحث</span>}
                            {room.amenities?.slice(0, 1).map((amenity) => <span key={String(amenity)} className="inline-flex items-center gap-2"><Wifi size={17} className="text-blue-700" /> {amenity}</span>)}
                        </div>
                        {room.meal && <p className="mt-3 text-sm font-semibold text-slate-600">{room.meal === 'nomeal' ? 'بدون وجبات' : room.meal === 'breakfast' ? 'الإفطار مشمول' : room.meal}</p>}
                        <div className="mt-4"><CancellationPolicy cancellation={room.cancellation} currency={room.currency} /></div>
                    </div>
                    <div className="min-w-0 border-t border-slate-100 pt-6 text-start xl:border-s xl:border-t-0 xl:ps-7 xl:pt-0">
                        <div aria-live="polite" aria-atomic="true">
                            <p className="text-xs font-bold text-slate-500">السعر الإجمالي</p>
                            <PriceDisplay amount={room.price} currency={room.currency || 'USD'} displayCurrency={displayCurrency} displayRates={displayRates} className="mt-1 text-3xl font-extrabold text-slate-900" />
                            <p className="mt-1 text-xs leading-6 text-slate-600">إجمالي الإقامة المحددة؛ قد تُطبق رسوم محلية.</p>
                            {additionalTaxes.map((tax, index) => <p key={index} className="text-xs leading-6 text-slate-600">رسوم غير مشمولة: {tax.name} {tax.amount} {tax.currency_code}</p>)}
                        </div>
                        <div className="mt-4 flex flex-col gap-2">
                            <button type="button" onClick={() => onBook?.(room)} disabled={!payable} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-slate-900 to-slate-800 px-5 py-3 font-bold text-white transition-transform hover:scale-[1.02] motion-reduce:transform-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100">
                                اختيار الغرفة <ArrowLeft size={17} />
                            </button>
                            {!payable && <p className="text-xs leading-6 text-slate-600">هذا العرض غير متاح للدفع الإلكتروني.</p>}
                        </div>
                    </div>
                </div>
            </div>
        </article>
    );
}
