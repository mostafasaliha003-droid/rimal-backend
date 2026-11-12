import { useLanguage } from '../i18n';
import { hotelPolicyCopy, hotelPolicySections, hotelExtraInformation } from '../services/hotelPolicies.js';

export default function HotelPolicies({ hotel = {} }) {
    const { language } = useLanguage();
    const copy = hotelPolicyCopy(language);
    const sections = hotelPolicySections(hotel, language);
    const extra = hotelExtraInformation(hotel);
    if (!sections.length && !extra) return null;
    return <section data-hotel-policies aria-labelledby="hotel-policies-title" className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <h2 id="hotel-policies-title" className="text-2xl font-black text-slate-900">{copy.title}</h2>
        <div className="mt-5 space-y-5">
            {sections.map(section => <section key={section.key} className="border-b border-slate-100 pb-5 last:border-0 last:pb-0">
                <h3 className="text-base font-bold text-slate-900">{section.title}</h3>
                <dl className="mt-2 space-y-2 text-sm leading-6 text-slate-600">
                    {section.rows.map((row, index) => <div key={index} className="break-words">
                        {row.label && <dt className="inline font-semibold">{row.label}: </dt>}
                        <dd className="inline whitespace-pre-line">{row.value}</dd>
                    </div>)}
                </dl>
            </section>)}
            {extra && <section data-hotel-extra-information>
                <h3 className="text-base font-bold text-slate-900">{copy.extra}</h3>
                <p className="mt-2 whitespace-pre-line break-words text-sm leading-7 text-slate-600">{extra}</p>
            </section>}
        </div>
    </section>;
}
