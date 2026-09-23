import { ArrowLeft, Wifi } from 'lucide-react';
import { BedIcon, UsersIcon } from './Icons';
import PriceDisplay from './PriceDisplay';

export function CancellationPolicy({ cancellation, currency }) {
    const deadline = cancellation?.free_cancellation_before;
    return <div className="text-sm leading-7">
        <p className={deadline ? 'text-emerald-800' : 'text-slate-700'}>{deadline ? `إلغاء مجاني حتى ${deadline.replace('T', ' ')} (بتوقيت المورد)` : 'لا يوجد إلغاء مجاني مؤكد لهذا العرض'}</p>
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
            className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_2px_10px_rgb(0,0,0,0.04)] transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
        >
            <div className="min-w-0">
                <div className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,1fr)_15rem] xl:items-center">
                    <div className="min-w-0 text-right">
                        <h3 id={`room-${room.book_hash || room.roomId || room.name}`} className="text-xl font-black leading-8 text-slate-900">{room.name || 'غرفة فندقية'}</h3>
                        {room.cancellation?.free_cancellation_before && <span className="mt-3 inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">إلغاء مجاني</span>}
                        <div className="mt-5 flex flex-wrap justify-end gap-x-5 gap-y-3 text-xs font-bold text-slate-600">
                            {typeof room.bed === 'string' && <span className="inline-flex items-center gap-2"><BedIcon size={17} />{room.bed}</span>}
                            {room.guests && <span className="inline-flex items-center gap-2"><UsersIcon size={17} />{room.guests.reduce((total, group) => total + group.adults + group.children.length, 0)} ضيوف حسب البحث</span>}
                            {room.amenities?.slice(0, 1).map((amenity) => <span key={String(amenity)} className="inline-flex items-center gap-2"><Wifi size={17} className="text-blue-700" /> {amenity}</span>)}
                        </div>
                        <div className="mt-5"><CancellationPolicy cancellation={room.cancellation} currency={room.currency} /></div>
                        {room.meal && <p className="mt-2 text-sm text-slate-600">{room.meal === 'nomeal' ? 'بدون وجبات' : room.meal === 'breakfast' ? 'الإفطار مشمول' : room.meal}</p>}
                    </div>
                    <div className="border-t border-slate-200 pt-5 text-right xl:border-r xl:border-t-0 xl:pr-6 xl:pt-0">
                        <div aria-live="polite" aria-atomic="true">
                            <p className="text-xs font-bold text-slate-500">السعر الإجمالي</p>
                            <PriceDisplay amount={room.price} currency={room.currency || 'USD'} displayCurrency={displayCurrency} displayRates={displayRates} className="mt-1 text-3xl font-extrabold text-slate-900" />
                            <p className="mt-1 text-xs leading-6 text-slate-600">إجمالي الإقامة المحددة؛ قد تُطبق رسوم محلية.</p>
                            {additionalTaxes.map((tax, index) => <p key={index} className="text-xs leading-6 text-slate-600">رسوم غير مشمولة: {tax.name} {tax.amount} {tax.currency_code}</p>)}
                        </div>
                        <div className="mt-4 flex flex-col gap-2">
                            <button type="button" onClick={() => onBook?.(room)} disabled={!payable} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-remal-dark px-5 py-3 font-bold text-white disabled:opacity-50">
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
