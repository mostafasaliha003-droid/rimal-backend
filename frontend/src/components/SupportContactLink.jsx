import { useLanguage } from '../i18n';
export default function SupportContactLink({ reference, children, className }) {
    const { language, t } = useLanguage();
    return <a className={className} href={`/support?lang=${language}${reference ? `&reference=${encodeURIComponent(reference)}` : ''}`}>{children || t('checkout.paymentHelp')}</a>;
}
