import { createContext, useContext, useEffect, useState } from 'react';
import { Heart, MapPin, Search, Trash2 } from 'lucide-react';
import { useLanguage } from '../i18n';

export const MemberIdentity = createContext(null);
const copy = {
    ar: ['المفضلة', 'حفظ الفندق', 'إزالة من المفضلة', 'لم تحفظ فنادق بعد', 'احفظ الفندق من بطاقة النتائج لتجده هنا عند التخطيط لإقامتك.', 'اختيار التواريخ', 'اكتشف الفنادق', 'تعذّر حفظ التغييرات على هذا الجهاز.'],
    en: ['Saved stays', 'Save hotel', 'Remove from saved stays', 'No saved hotels yet', 'Use the heart on a hotel card to keep it here for your next stay.', 'Choose dates', 'Explore hotels', 'Could not save changes on this device.'],
    es: ['Guardados', 'Guardar hotel', 'Quitar de guardados', 'Aún no hay hoteles guardados', 'Usa el corazón de una tarjeta para guardar el hotel.', 'Elegir fechas', 'Explorar hoteles', 'No se pudo guardar el cambio en este dispositivo.']
};
function read(key) {
    if (!key) return [];
    try {
        const entries = JSON.parse(localStorage.getItem(key) || '[]');
        return Array.isArray(entries) ? entries.filter(item => item && Number.isSafeInteger(item.id) && item.id > 0 && typeof item.name === 'string') : [];
    } catch { return []; }
}
function useSaved() {
    const user = useContext(MemberIdentity);
    const identity = user?.id || user?.email;
    const key = identity ? 'pillow.saved.' + String(identity).toLowerCase() : null;
    const [entries, setEntries] = useState(() => read(key));
    const [error, setError] = useState(false);
    useEffect(() => {
        const refresh = () => setEntries(read(key));
        refresh();
        window.addEventListener('storage', refresh);
        window.addEventListener('pillow:saved', refresh);
        return () => { window.removeEventListener('storage', refresh); window.removeEventListener('pillow:saved', refresh); };
    }, [key]);
    const toggle = item => {
        if (!key) return;
        try {
            const current = read(key);
            const next = current.some(value => value.id === item.id) ? current.filter(value => value.id !== item.id) : [...current, item];
            localStorage.setItem(key, JSON.stringify(next)); setError(false);
            window.dispatchEvent(new Event('pillow:saved'));
        } catch { setError(true); }
    };
    return { entries, toggle, key, error };
}
export function SaveHotel({ hotel }) {
    const { language } = useLanguage();
    const L = copy[language] || copy.en;
    const { entries, toggle, key, error } = useSaved();
    const id = Number(hotel.hid || hotel.id);
    if (!key || !Number.isSafeInteger(id) || id <= 0 || !hotel.name) return null;
    const saved = entries.some(item => item.id === id);
    return <><button type="button" className="pillow-save" aria-label={saved ? L[2] : L[1]} aria-pressed={saved}
        onClick={() => toggle({ id, name: hotel.name, city: typeof hotel.city === 'string' ? hotel.city : '' })}><Heart size={20} fill={saved ? 'currentColor' : 'none'} /></button>
        {error && <span className="pillow-save-error" role="alert">{L[7]}</span>}</>;
}
export default function SavedStays({ onExplore }) {
    const { language } = useLanguage(), L = copy[language] || copy.en;
    const { entries, toggle, error } = useSaved();
    return <main className="pillow-saved-page"><h1>{L[0]}</h1>{error && <p role="alert">{L[7]}</p>}
        {entries.length ? <ul>{entries.map(item => <li key={item.id}><div><h2>{item.name}</h2>{item.city && <p><MapPin size={16} />{item.city}</p>}</div>
            <button type="button" className="pillow-primary" onClick={() => onExplore(item)}>{L[5]}</button>
            <button type="button" className="pillow-icon" aria-label={L[2] + ' · ' + item.name} onClick={() => toggle(item)}><Trash2 size={19} /></button></li>)}</ul>
            : <section><Heart size={34} aria-hidden="true" /><h2>{L[3]}</h2><p>{L[4]}</p><button className="pillow-primary" type="button" onClick={() => onExplore()}><Search size={17} />{L[6]}</button></section>}
    </main>;
}
