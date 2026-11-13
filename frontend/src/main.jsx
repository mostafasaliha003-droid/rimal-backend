import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { LanguageProvider, useLanguage } from './i18n';

function PageLoading() {
    const { language, direction } = useLanguage();
    const labels = { ar: 'جار تحميل الصفحة...', en: 'Loading page...', es: 'Cargando la página...' };
    return <main dir={direction}><p role="status" className="p-10 text-center">{labels[language] || labels.en}</p></main>;
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).catch(() => {});
    });
}

createRoot(document.getElementById('root')).render(
    <StrictMode>
        <LanguageProvider>
            <Suspense fallback={<PageLoading />}><App /></Suspense>
        </LanguageProvider>
    </StrictMode>
);
