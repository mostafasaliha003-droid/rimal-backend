import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    });
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <Suspense fallback={<main role="status" className="p-10 text-center">جار تحميل الصفحة...</main>}><App /></Suspense>
    </StrictMode>
);
