import { useEffect, useState } from 'react';
import { useLanguage } from '../i18n';
import PillowBrand from './PillowBrand';
import './PillowWait.css';

const messages = {
    ar: {
        search: ['نبحث عن فنادق لتواريخك', 'تخيّل صباحك هناك. قهوة على مهل أم جولة مبكرة؟', 'ما زلنا ننتظر عروض الإقامة لهذه التواريخ.'],
        hotel: ['نحضّر الغرف وشروط الإقامة', 'كل رحلة تبدأ باختيار صغير. أي غرفة ستختار؟', 'ما زلنا ننتظر تفاصيل الفندق والغرف.'],
        rooms: ['نحمّل الغرف المتاحة', 'سرير واسع أم إطلالة واسعة؟', 'ما زلنا ننتظر عروض الغرف.'],
        membership: ['نتحقق من حالة العضوية'],
        page: ['نفتح الصفحة']
    },
    en: {
        search: ['Finding hotels for your dates', 'Picture your first morning. A slow coffee or an early wander?', 'Still waiting for availability for your dates.'],
        hotel: ['Loading rooms and stay details', 'Every trip starts with a little choice. Which room feels like you?', 'Still waiting for hotel and room details.'],
        rooms: ['Loading available rooms', 'A king-size bed or a wide-open view?', 'Still waiting for room offers.'],
        membership: ['Checking your membership'],
        page: ['Opening the page']
    },
    es: {
        search: ['Buscando hoteles para tus fechas', 'Imagina tu primera mañana. ¿Un café sin prisa o un paseo temprano?', 'Seguimos esperando la disponibilidad para tus fechas.'],
        hotel: ['Cargando habitaciones y detalles de la estancia', 'Cada viaje empieza con una elección. ¿Qué habitación va contigo?', 'Seguimos esperando los detalles del hotel y sus habitaciones.'],
        rooms: ['Cargando habitaciones disponibles', '¿Una cama grande o unas vistas amplias?', 'Seguimos esperando las ofertas de habitaciones.'],
        membership: ['Comprobando tu membresía'],
        page: ['Abriendo la página']
    }
};

export default function PillowWait({ stage = 'page' }) {
    const { language, direction } = useLanguage();
    const [phase, setPhase] = useState('brief');
    const [status, hint, slow] = (messages[language] || messages.en)[stage];
    const hasSlowMessage = Boolean(slow);
    useEffect(() => {
        const timer = window.setTimeout(() => setPhase('visible'), 300);
        const slowTimer = hasSlowMessage ? window.setTimeout(() => setPhase('slow'), 8000) : undefined;
        return () => { window.clearTimeout(timer); window.clearTimeout(slowTimer); };
    }, [stage, hasSlowMessage]);
    const visible = phase !== 'brief';
    const supporting = phase === 'slow' ? slow : hint;
    return <section className="pillow-wait" dir={direction} data-wait-stage={stage}>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{visible ? (phase === 'slow' ? slow : status) : ''}</div>
        {visible && <div className="pillow-wait-card" data-wait-visible aria-hidden="true">
            <div className="pillow-wait-emblem"><span className="pillow-wait-orbit" /><PillowBrand /></div>
            <p className="pillow-wait-title">{status}</p>
            {supporting && <p className="pillow-wait-hint">{supporting}</p>}
        </div>}
    </section>;
}
