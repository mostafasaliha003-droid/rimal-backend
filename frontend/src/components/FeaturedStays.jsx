import { useEffect, useState } from 'react';
import { BedDouble, MapPin } from 'lucide-react';
import BookingAPI from '../services/bookingApi';
import { useLanguage } from '../i18n';
import { hotelImages, responsiveImageSources } from '../services/hotelImages';
import { normalizeSuggestions } from './search/searchModel';
import { SaveHotel } from './SavedStays';

const copy = {
    ar: ['إقامات تستحق الاكتشاف', 'استكشف دبي', 'اختيار تواريخ الإقامة'],
    en: ['Stays to explore', 'Discover Dubai', 'Choose stay dates'],
    es: ['Estancias para descubrir', 'Descubre Dubái', 'Elegir fechas']
};
export default function FeaturedStays({ previous, onChoose }) {
    const { language }=useLanguage(), T=copy[language]||copy.en;
    const [stays,setStays]=useState([]);
    const region=previous?.destination?.region_id;
    useEffect(()=>{
        const controller=new AbortController(), options={signal:controller.signal}; setStays([]);
        async function load(){
            // The site's Dubai destination is a starting point. Property order, names and pictures come from the catalog.
            let id=region;
            if(!id){
                const places=normalizeSuggestions(await BookingAPI.suggest('Dubai','en',options));
                id=places.find(p=>p.type==='region' && /^Dubai(?:$|,| ·)/i.test(p.label))?.region_id;
            }
            if(!id || controller.signal.aborted)return;
            const ranked=await BookingAPI.sortRegionHotels(id,3,options);
            if(controller.signal.aborted)return;
            const ids=[...new Set((ranked.hotels||[]).map(item=>Number(item?.hid ?? item?.id ?? item)).filter(h=>Number.isSafeInteger(h) && h>0))].slice(0,3);
            const response=await Promise.allSettled(ids.map(h=>BookingAPI.getHotelStatic(h,language,options)));
            if(!controller.signal.aborted)setStays(response.filter(item=>item.status==='fulfilled').map(item=>item.value.hotel).filter(h=>h?.hid && typeof h.name==='string' && h.name.trim()));
        }
        void load().catch(()=>{});
        return ()=>controller.abort();
    },[region,language]);
    if(!stays.length)return null;
    return <section className="pillow-featured" aria-labelledby="featured-title"><h2 id="featured-title">{T[0]}</h2><div>
        {stays.map(h=>{const first=hotelImages(h)[0], src=first && responsiveImageSources(first,'card');return <article key={h.hid}>
            <div className="pillow-featured-photo">{src?<img src={src.src} srcSet={src.srcSet} sizes="(max-width: 767px) 90vw, 32vw" loading="lazy" alt="" />:<BedDouble size={32} aria-hidden="true"/>}<SaveHotel hotel={h}/></div>
            <div className="pillow-featured-details"><h3>{h.name}</h3>{h.city && <p><MapPin size={15}/>{h.city}</p>}
            <button type="button" onClick={()=>onChoose(h)}>{T[2]}</button></div></article>;})}
    </div></section>;
}
