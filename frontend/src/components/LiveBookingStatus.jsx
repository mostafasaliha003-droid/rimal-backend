import { useEffect, useState } from 'react';
import { Check, CheckCheck, CreditCard, Hotel, Mail, MessageCircle, ShieldCheck, ArrowUpRight } from 'lucide-react';
import { useLanguage } from '../i18n';
import './LiveBookingStatus.css';
import SupportContactLink from './SupportContactLink';
import PillowBrand from './PillowBrand';
import { paymentRedirect } from '../services/pendingPayment';

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
    const redirect = connected && !paid && status?.status === 'awaiting_payment' && paymentRedirect(status.payment_url);
    const headline = t(redirect ? 'tracking.resumeTitle' : sent ? 'tracking.sentTitle' : confirmed ? 'tracking.confirmedTitle' : paid ? 'tracking.bookingTitle' : 'tracking.checkingTitle');
    const body = t(sent ? 'tracking.sentBody' : deliveryReview ? 'tracking.deliveryReviewBody'
        : confirmed ? 'tracking.confirmedBody' : paid ? 'tracking.bookingBody' : redirect ? 'tracking.resumeBody' : 'tracking.checkingBody');
    const terminal = sent || deliveryReview;
    const HeroIcon = confirmed ? CheckCheck : redirect ? CreditCard : Hotel;
    return (
        <main dir={direction} className="booking-live" data-booking-live data-tracking-state={sent ? 'sent' : confirmed ? 'confirmed' : 'pending'}>
            <section className="booking-live__card" aria-labelledby="payment-status-title">
                <header className="booking-live__header">
                    <PillowBrand />
                    <span className={`booking-live__badge ${!connected && !terminal ? 'is-reconnecting' : ''}`}>
                        <span className={!terminal && connected ? 'is-pulsing' : ''} aria-hidden="true" />
                        {t(sent ? 'tracking.complete' : deliveryReview ? 'tracking.confirmedBadge' : !connected ? 'tracking.reconnecting' : 'tracking.live')}
                    </span>
                </header>
                <div className="booking-live__hero">
                    <div className={`booking-live__orbit ${confirmed ? 'is-confirmed' : ''}`} aria-hidden="true"><HeroIcon size={32} strokeWidth={1.6} /></div>
                    <div role="status" aria-live="polite" aria-atomic="true">
                        <h1 id="payment-status-title">{headline}</h1>
                        <p className="booking-live__description">{body}</p>
                    </div>
                    {redirect && <a className="booking-live__resume" href={redirect}>{t('tracking.resumeAction')} <ArrowUpRight size={17} aria-hidden="true" /></a>}
                </div>
                <ol className="booking-live__steps" aria-label={t('tracking.stepsLabel')}>
                    {steps.map(({ icon: Icon, key, done, active }) => (
                        <li key={key} className={`${done ? 'is-done' : active ? 'is-active' : ''}`} aria-current={active ? 'step' : undefined}>
                            <span className="booking-live__step-icon" aria-hidden="true">{done ? <Check size={19} /> : <Icon size={19} strokeWidth={1.6} />}</span>
                            <span className="booking-live__step-copy"><strong>{t(`tracking.${key}`)}</strong><span>{t(done ? 'tracking.done' : active ? deliveryReview ? 'tracking.deliveryAttention' : redirect ? 'tracking.awaitingPayment' : 'tracking.inProgress' : 'tracking.next')}</span></span>
                        </li>
                    ))}
                </ol>
                {!terminal && <div className="booking-live__update">
                    <span className={`booking-live__update-dot ${connected ? '' : 'is-reconnecting'}`} aria-hidden="true" />
                    <span>{t(!connected ? 'tracking.connectionNote' : elapsed >= 180000 ? confirmed ? 'tracking.deliveryDelayNote' : 'tracking.delayNote' : 'tracking.autoUpdate')}</span>
                    {updatedAt && <time dateTime={new Date(updatedAt).toISOString()}>{new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(updatedAt)}</time>}
                </div>}
                {!redirect && <div className="booking-live__assurance"><ShieldCheck size={18} aria-hidden="true" /><span>{t(sent ? 'tracking.inboxNote' : 'tracking.noRetry')}</span></div>}
                <div className="booking-live__reference"><span>{t('checkout.requestReference')}</span><span dir="ltr">{reference}</span></div>
                {confirmed && status.supplier_reference && <p className="booking-live__supplier">{t('checkout.supplierReference', 'مرجع المورد: {{reference}}', { reference: status.supplier_reference })}</p>}
                <footer className="booking-live__footer">
                    <SupportContactLink reference={reference}><MessageCircle size={16} aria-hidden="true" />{t('checkout.paymentHelp')}</SupportContactLink>
                    <a href="/">{t('checkout.home', 'العودة للرئيسية')}<ArrowUpRight size={15} aria-hidden="true" /></a>
                </footer>
            </section>
        </main>
    );
}
