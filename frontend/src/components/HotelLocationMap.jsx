import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useLanguage } from '../i18n';
import { cheapestRate, formatMoney, rateAmount, rateCurrency } from '../services/offers';

export function hotelCoordinates(hotel) {
    const data = hotel?.staticData || {};
    const number = value => (typeof value==='number' || typeof value==='string' && value.trim()) ? Number(value) : NaN;
    const lat = number(hotel?.latitude ?? data.latitude), lon = number(hotel?.longitude ?? data.longitude);
    return Number.isFinite(lat) && Math.abs(lat)<=90 && Number.isFinite(lon) && Math.abs(lon)<=180 ? [lat,lon] : null;
}
const copy = {
    ar:['خريطة الفنادق','ابحث في هذه المنطقة','عرض الفندق','خريطة الموقع','فتح الموقع في الخرائط','تعذّر تحميل خلفية الخريطة. تبقى قائمة الفنادق متاحة.'],
    en:['Hotel map','Search this area','View hotel','Location map','Open location in maps','Map tiles could not load. The hotel list is still available.'],
    es:['Mapa de hoteles','Buscar en esta zona','Ver hotel','Mapa de ubicación','Abrir en el mapa','No se pudo cargar el mapa. La lista de hoteles sigue disponible.']
};
export default function HotelLocationMap({ hotels, onSelect, onArea }) {
    const { language }=useLanguage(), T=copy[language] || copy.en;
    const host=useRef(null), mapRef=useRef(null), ref=useRef(null);
    const [moved,setMoved]=useState(false), [chosen,setChosen]=useState(null), [tileError,setTileError]=useState(false);
    const points=hotels.map(hotel=>({hotel,coords:hotelCoordinates(hotel)})).filter(item=>item.coords);
    ref.current=points;
    const signature=JSON.stringify(points.map(({hotel,coords})=>[hotel.hid||hotel.id,coords,hotel.name,rateAmount(cheapestRate(hotel.rates || []))]));
    useEffect(()=>{
        const entries=ref.current;
        if(!entries.length || !host.current)return undefined;
        const map=L.map(host.current,{scrollWheelZoom:false,attributionControl:true});
        mapRef.current=map; map.attributionControl.setPrefix(false);
        const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
        tiles.on('tileerror',()=>setTileError(true));
        const bounds=L.latLngBounds([]);
        entries.forEach(({hotel,coords},i)=>{
            bounds.extend(coords);
            const rate=cheapestRate(hotel.rates || []), amount=rate && rateAmount(rate);
            const label=document.createElement('span');label.textContent=Number.isFinite(amount)?formatMoney(amount,rateCurrency(rate),language):String(i+1);
            const id=hotel.hid||hotel.id;
            L.marker(coords,{title:hotel.name || T[3],icon:L.divIcon({className:'pillow-map-pin',html:label,iconSize:null}),keyboard:true}).addTo(map).on('click',()=>setChosen(id));
        });
        map.fitBounds(bounds,{padding:[32,32],maxZoom:15});
        map.on('moveend',()=>setMoved(true));
        setChosen(null);setMoved(false);setTileError(false);
        const resize=new ResizeObserver(()=>map.invalidateSize({pan:false}));resize.observe(host.current);
        return ()=>{resize.disconnect();map.remove();mapRef.current=null;};
    },[signature,language]);
    if(!points.length)return onArea ? <p role="status" className="pillow-map-empty">{language==='ar'?'لم يرسل المورد إحداثيات لهذه النتائج. يمكنك متابعة البحث في القائمة.':language==='es'?'Estos resultados no incluyen coordenadas. Utiliza la lista.':'No map coordinates were supplied for these results. You can still use the list.'}</p> : null;
    const selected=points.find(({hotel})=>(hotel.hid||hotel.id)===chosen);
    return <div className="pillow-map-panel"><div ref={host} role="region" aria-label={T[0]} className="pillow-map" />
        {tileError && <p role="status">{T[5]}</p>}
        {moved && onArea && <button className="pillow-primary" type="button" onClick={()=>{
            const map=mapRef.current,center=map.getCenter(),bounds=map.getBounds();
            onArea({latitude:center.lat,longitude:center.wrap().lng,radius:Math.min(50000,Math.max(100,Math.round(center.distanceTo(bounds.getNorthEast()))))});
        }}>{T[1]}</button>}
        {selected && onSelect && <div className="pillow-map-selected"><strong>{selected.hotel.name}</strong><button type="button" onClick={()=>onSelect(selected.hotel)}>{T[2]}</button></div>}
        {points.length===1 && !onArea && <a target="_blank" rel="noopener noreferrer" href={'https://www.openstreetmap.org/?mlat='+points[0].coords[0]+'&mlon='+points[0].coords[1]+'#map=16/'+points[0].coords.join('/')}>{T[4]}</a>}
    </div>;
}
