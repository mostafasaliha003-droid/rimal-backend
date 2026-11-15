import { useLanguage } from '../i18n';
import { hotelPolicyCopy, hotelPolicySections, hotelExtraInformation } from '../services/hotelPolicies.js';

export default function HotelPolicies({ hotel = {} }) {
    const { language } = useLanguage();
    const copy = hotelPolicyCopy(language);
    const sections = hotelPolicySections(hotel, language);
    const extra = hotelExtraInformation(hotel);
    if (!sections.length && !extra) return null;
    return <section data-hotel-policies dir={language === 'ar' ? 'rtl' : 'ltr'} aria-labelledby="hotel-policies-title" className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="hotel-policies-title" className="text-2xl font-black text-slate-900">{copy.title}</h2>
        <div className="mt-5 space-y-5">
            {sections.map(section => <section data-policy-section={section.key} key={section.key} className="border-b border-slate-100 pb-5 last:border-0 last:pb-0">
                <h3 className="text-base font-bold text-slate-900">{section.title}</h3>
                <ul className="mt-3 grid list-none gap-3 p-0 xl:grid-cols-2">
                    {section.entries.map((entry, entryIndex) => <li data-policy-entry key={entryIndex} className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                        <dl className="space-y-3 text-sm leading-6">
                            {entry.rows.map((row, index) => <div key={index} className="grid min-w-0 gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
                                {row.label && <dt className="break-words text-slate-600">{row.label}</dt>}
                                <dd className={`min-w-0 whitespace-pre-line break-words ${row.emphasis ? 'font-bold text-slate-900' : 'font-medium text-slate-800'} ${row.label ? '' : 'sm:col-span-2'}`}>
                                    {row.segments ? row.segments.map((segment, segmentIndex) => <span key={segmentIndex}>{segmentIndex > 0 ? row.separator : ''}<bdi dir={segment.direction}>{segment.text}</bdi></span>) : <bdi dir="auto">{row.value}</bdi>}
                                </dd>
                            </div>)}
                        </dl>
                    </li>)}
                </ul>
            </section>)}
            {extra && <section data-hotel-extra-information>
                <h3 className="text-base font-bold text-slate-900">{copy.extra}</h3>
                <p dir="auto" className="mt-2 whitespace-pre-line break-words text-sm leading-7 text-slate-600">{extra}</p>
            </section>}
        </div>
    </section>;
}
