import { useEffect, useState } from 'react';
import { Download, RefreshCw, WifiOff } from 'lucide-react';

export default function PwaStatus() {
    const [online, setOnline] = useState(navigator.onLine);
    const [installPrompt, setInstallPrompt] = useState(null);
    const [waiting, setWaiting] = useState(null);
    useEffect(() => {
        let active = true;
        let registration;
        let worker;
        const connection = () => setOnline(navigator.onLine);
        const install = event => { event.preventDefault(); setInstallPrompt(event); };
        const installed = () => setInstallPrompt(null);
        const check = () => { if (active && registration?.waiting) setWaiting(registration.waiting); };
        const update = () => { worker = registration.installing; worker?.addEventListener('statechange', check); };
        window.addEventListener('online', connection);
        window.addEventListener('offline', connection);
        window.addEventListener('beforeinstallprompt', install);
        window.addEventListener('appinstalled', installed);
        if ('serviceWorker' in navigator) navigator.serviceWorker.ready.then(value => {
            if (!active) return;
            registration = value;
            check();
            registration.addEventListener('updatefound', update);
        });
        return () => {
            active = false;
            window.removeEventListener('online', connection);
            window.removeEventListener('offline', connection);
            window.removeEventListener('beforeinstallprompt', install);
            window.removeEventListener('appinstalled', installed);
            registration?.removeEventListener('updatefound', update);
            worker?.removeEventListener('statechange', check);
        };
    }, []);
    const applyUpdate = () => {
        navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
        waiting.postMessage({ type: 'SKIP_WAITING' });
    };
    if (!online) return <div role="status" className="flex items-center justify-center gap-2 bg-amber-50 px-4 py-3 text-sm text-amber-950"><WifiOff size={18} />الاتصال منقطع. الأسعار والدفع غير متاحين حالياً.</div>;
    if (window.location.pathname === '/checkout') return null;
    if (!waiting && !installPrompt) return null;
    return <div className="flex flex-wrap justify-center gap-4 bg-white px-4 py-2 text-sm text-remal-dark">
        {waiting && <button onClick={applyUpdate} className="flex min-h-11 items-center gap-2"><RefreshCw size={18} />تحديث التطبيق</button>}
        {installPrompt && <button onClick={async () => { await installPrompt.prompt(); setInstallPrompt(null); }} className="flex min-h-11 items-center gap-2"><Download size={18} />تثبيت رمال</button>}
    </div>;
}