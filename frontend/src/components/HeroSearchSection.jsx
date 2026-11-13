import { Sparkles } from 'lucide-react';
import { useLanguage } from '../i18n';
import SearchController from './search/SearchController';
import { heroMedia } from '../services/brandMedia';

export default function HeroSearchSection({ onSearch, initialSearch, isSearching, searchError }) {
    const { t, direction } = useLanguage();
    return <>
        <section id="search" className="hero-search relative isolate overflow-visible py-14 lg:py-20" dir={direction}>
            <picture aria-hidden="true" className="absolute inset-0 -z-10 block h-full w-full opacity-35">
                <source type="image/avif" srcSet={heroMedia.avifSrcSet} sizes={heroMedia.sizes} />
                <source type="image/webp" srcSet={heroMedia.webpSrcSet} sizes={heroMedia.sizes} />
                <img src={heroMedia.src} srcSet={heroMedia.webpSrcSet} sizes={heroMedia.sizes}
                    width={heroMedia.width} height={heroMedia.height} alt="" loading="eager"
                    fetchPriority="high" decoding="async" className="h-full w-full object-cover object-center" />
            </picture>
            <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-br from-remal-navy/95 via-[#123c55]/90 to-remal-blue/75" />
            <div aria-hidden="true" className="absolute inset-x-0 bottom-0 -z-10 h-28 bg-gradient-to-t from-remal-bg to-transparent" />
            <div className="mx-auto max-w-7xl px-5 lg:px-10">
                <div className="max-w-3xl text-start text-white">
                    <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/20 bg-remal-navy/90 px-4 py-2 text-xs font-bold">
                        <Sparkles size={14} aria-hidden="true" />{t('search.badge', 'ابحث، قارن، ثم اختر بثقة')}
                    </div>
                    <h1 className="text-4xl font-black leading-tight sm:text-6xl">{t('search.title', 'إقامتك القادمة تبدأ من اختيار أوضح')}</h1>
                    <p className="mt-5 max-w-2xl text-base font-medium leading-relaxed text-white sm:text-lg">{t('search.description', 'قارن الأسعار والتوفر وشروط الإلغاء من مكان واحد، ثم انتقل إلى العرض الذي يناسب رحلتك.')}</p>
                    <div className="mt-6 flex flex-wrap gap-3 text-xs font-bold">
                        <span className="rounded-full border border-white/20 bg-remal-navy/80 px-3 py-2">{t('search.directPrices', 'أسعار مباشرة')}</span>
                        <span className="rounded-full border border-white/20 bg-remal-navy/80 px-3 py-2">{t('search.comparableDetails', 'تفاصيل قابلة للمقارنة')}</span>
                        <span className="rounded-full border border-white/20 bg-remal-navy/80 px-3 py-2">{t('search.clearCancellation', 'شروط إلغاء واضحة')}</span>
                    </div>
                </div>
            </div>
        </section>
        {/* Keep the sticky shell outside the hero so its containing block spans the results. */}
        <SearchController onSearch={onSearch} initialSearch={initialSearch} isSearching={isSearching} searchError={searchError} />
    </>;
}
