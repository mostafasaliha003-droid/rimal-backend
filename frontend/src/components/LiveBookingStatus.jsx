import { useEffect, useState } from 'react';
import { Check, CheckCheck, CreditCard, Hotel, Mail, MessageCircle, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '../i18n';
import './LiveBookingStatus.css';
import SupportContactLink from './SupportContactLink';

export default function LiveBookingStatus({ status, reference, connection, updatedAt }) {
    const { t, direction, language } = useLanguage();
    const [elapsed, setElapsed] = useState(0);
    useEffect(() => {
        const started = Date.now();
        const timer = window.setInterval(() => setElapsed(Date.now() - started), 15000);
        return () => window.clearInterval(timer);
    }, []);
    const confirmed = status?.status === 'booking_confirmed';
    const sent = confirmed && status.voucher_delivery === 'sent';
    const deliveryReview = confirmed && status.voucher_delivery === 'review';
    const paid = status?.payment_verified === true || confirmed || ['payment_verified', 'booking_pending'].includes(status?.status);
    const connected = connection === 'connected';
    const steps = [
        { icon: CreditCard, key: 'payment', done: paid, active: !paid },
        { icon: Hotel, key: 'booking', done: confirmed, active: paid && !confirmed },
        { icon: Mail, key: 'voucher', done: sent, active: confirmed && !sent }
    ];
    const headline = t(sent ? 'tracking.sentTitle' : confirmed ? 'tracking.confirmedTitle' : paid ? 'tracking.bookingTitle' : 'tracking.checkingTitle');
    const body = t(sent ? 'tracking.sentBody' : deliveryReview ? 'tracking.deliveryReviewBody'
        : confirmed ? 'tracking.confirmedBody' : paid ? 'tracking.bookingBody' : 'tracking.checkingBody');
    const terminal = sent || deliveryReview;
    const HeroIcon = confirmed ? CheckCheck : Hotel;
    return (
        <main dir={direction} className="booking-live" data-booking-live data-tracking-state={sent ? 'sent' : confirmed ? 'confirmed' : 'pending'}>
            <div className="booking-live__ambient" aria-hidden="true" />
            <section className="booking-live__card" aria-labelledby="payment-status-title">
                <header className="booking-live__header">
                    <span className="booking-live__brand">REMAL<span>{t('tracking.brandLine')}</span></span>
                    <span className={`booking-live__badge ${!connected && !terminal ? 'is-reconnecting' : ''}`}>
                        <span className={!terminal && connected ? 'is-pulsing' : ''} aria-hidden="true" />
                        {t(sent ? 'tracking.complete' : deliveryReview ? 'tracking.confirmedBadge' : !connected ? 'tracking.reconnecting' : 'tracking.live')}
                    </span>
                </header>
                <div className="booking-live__hero">
                    <div className={`booking-live__orbit ${confirmed ? 'is-confirmed' : ''}`} aria-hidden="true"><div /><span><HeroIcon size={36} strokeWidth={1.5} /></span></div>
                    <p className="booking-live__eyebrow">{t(confirmed ? 'tracking.confirmedEyebrow' : 'tracking.eyebrow')}</p>
                    <div role="status" aria-live="polite" aria-atomic="true">
                        <h1 id="payment-status-title">{headline}</h1>
                        <p className="booking-live__description">{body}</p>
                    </div>
                </div>
                <ol className="booking-live__steps" aria-label={t('tracking.stepsLabel')}>
                    {steps.map(({ icon: Icon, key, done, active }, index) => (
                        <li key={key} className={`${done ? 'is-done' : active ? 'is-active' : ''}`} aria-current={active ? 'step' : undefined}>
                            <span className="booking-live__step-icon" aria-hidden="true">{done ? <Check size={19} /> : <Icon size={19} strokeWidth={1.6} />}</span>
                            <span className="booking-live__step-copy"><strong>{t(`tracking.${key}`)}</strong><span>{t(done ? 'tracking.done' : active ? deliveryReview ? 'tracking.deliveryAttention' : 'tracking.inProgress' : 'tracking.next')}</span></span>
                            <span className="booking-live__step-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                        </li>
                    ))}
                </ol>
                {!terminal && <div className="booking-live__update">
                    <span className={`booking-live__update-dot ${connected ? '' : 'is-reconnecting'}`} aria-hidden="true" />
                    <span>{t(!connected ? 'tracking.connectionNote' : elapsed >= 180000 ? confirmed ? 'tracking.deliveryDelayNote' : 'tracking.delayNote' : 'tracking.autoUpdate')}</span>
                    {updatedAt && <time dateTime={new Date(updatedAt).toISOString()}>{new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(updatedAt)}</time>}
                </div>}
                <div className="booking-live__assurance"><ShieldCheck size={18} aria-hidden="true" /><span>{t(sent ? 'tracking.inboxNote' : 'tracking.noRetry')}</span></div>
                <div className="booking-live__reference"><span>{t('checkout.requestReference')}</span><span dir="ltr">{reference}</span></div>
                {confirmed && status.supplier_reference && <p className="booking-live__supplier">{t('checkout.supplierReference', 'مرجع المورد: {{reference}}', { reference: status.supplier_reference })}</p>}
                <footer className="booking-live__footer">
                    <SupportContactLink reference={reference}><MessageCircle size={16} aria-hidden="true" />{t('checkout.paymentHelp')}</SupportContactLink>
                    <a href="/">{t('checkout.home', 'العودة للرئيسية')}<ArrowUpRight size={15} aria-hidden="true" /></a>
                </footer>
            </section>
            <p className="booking-live__signature">REMAL <span aria-hidden="true">·</span> {t('tracking.signature')}</p>
        </main>
    );
}
