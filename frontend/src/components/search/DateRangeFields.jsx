import { useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import DatePicker from 'react-datepicker';
import { differenceInCalendarDays, format, startOfDay } from 'date-fns';
import { arSA, enUS, es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { FieldError } from './SearchFeedback';
import { SearchDialog, useMediaQuery } from './SearchOverlay';
import { earliestCheckoutDate, latestArrivalDate, latestCheckoutDate, parseSearchDate } from './searchModel';

const translations = {
    ar: ['تأكيد التواريخ', 'عدد الليالي', 'اختر تاريخ الوصول', 'اختر تاريخ المغادرة', 'تغيير الوصول'],
    en: ['Confirm dates', 'Nights', 'Choose check-in', 'Choose check-out', 'Change check-in'],
    es: ['Confirmar fechas', 'Noches', 'Elige la llegada', 'Elige la salida', 'Cambiar llegada']
};
export default function DateRangeFields({ controller, onOpenChange }) {
    const { t, dates, errors, language, direction, changeDate } = controller;
    const [editing, setEditing] = useState(null);
    const [start, setStart] = useState(null), [end, setEnd] = useState(null);
    const trigger = useRef(null);
    const desktop = useMediaQuery('(min-width: 760px)');
    const L = translations[language] || translations.en;
    const locale = language === 'es' ? es : language === 'en' ? enUS : arSA;
    const open = (field, target) => {
        trigger.current = target;
        const arrival = parseSearchDate(dates.checkin), departure = parseSearchDate(dates.checkout);
        setStart(arrival); setEnd(departure);
        setEditing(field === 'checkout' && arrival ? 'checkout' : 'checkin'); onOpenChange(true);
    };
    const close = () => { setEditing(null); onOpenChange(false); };
    const confirm = () => {
        if (!start || !end || end <= start || end > latestCheckoutDate(start)) return;
        changeDate('checkin', format(start, 'yyyy-MM-dd')); changeDate('checkout', format(end, 'yyyy-MM-dd')); close();
    };
    const nights = start && end ? differenceInCalendarDays(end, start) : 0;
    const nightsLabel = nights > 0 ? L[1] + ' · ' + new Intl.NumberFormat(language).format(nights) : '';
    return <fieldset className="pillow-dates min-w-0 sm:col-span-2 xl:col-span-2"><legend className="sr-only">{t('search.stayDates', 'تواريخ الإقامة')}</legend>
        <div className="search-date-fields">{['checkin','checkout'].map((field,index) => <div key={field}>
            <div className={'search-field ' + (errors[field] ? 'search-field-invalid' : '')}>
                <label className="search-label" htmlFor={'search-' + field}>{t(index ? 'search.departure' : 'search.arrival',index ? 'تسجيل المغادرة' : 'تسجيل الوصول')}</label>
                <div className="pillow-date-input">
                    <button type="button" aria-label={L[2+index]} onClick={event => open(field,event.currentTarget)}><CalendarDays size={18} /></button>
                    <input id={'search-' + field} name={field} type="text" inputMode="numeric" autoComplete="off" dir="ltr"
                        aria-required="true" aria-invalid={Boolean(errors[field])} aria-describedby={errors[field] ? 'search-' + field + '-error' : undefined}
                        value={dates[field]} placeholder="YYYY-MM-DD" className="search-input" onChange={event => changeDate(field,event.target.value)}
                        onKeyDown={event => { if (event.key==='ArrowDown') {event.preventDefault();open(field,event.currentTarget);} }} />
                </div>
            </div><FieldError field={field} message={errors[field]} />
        </div>)}</div>
        {editing && <SearchDialog id="pillow-date-dialog" title={t('search.stayDates','تواريخ الإقامة')} closeLabel={t('search.close','إغلاق')} direction={direction} onClose={close} returnFocusRef={trigger}>
            {() => <div className="pillow-calendar"><div className="pillow-range-labels">
                {[['checkin', L[2],start],['checkout',L[3],end]].map(([field,label,date]) => <button type="button" key={field} disabled={field==='checkout' && !start} aria-pressed={field===editing} onClick={() => setEditing(field)}><small>{label}</small><bdi>{date ? format(date,'yyyy-MM-dd') : '—'}</bdi></button>)}
            </div>
            <DatePicker inline locale={locale} monthsShown={desktop ? 2 : 1} selected={editing==='checkin'?start:end} openToDate={editing==='checkin'?start:(end||start)}
                startDate={start} endDate={end} minDate={editing==='checkin'?startOfDay(new Date()):earliestCheckoutDate(start)}
                maxDate={editing==='checkin'?latestArrivalDate():latestCheckoutDate(start)}
                previousMonthAriaLabel={t('search.previousMonth','الشهر السابق')} nextMonthAriaLabel={t('search.nextMonth','الشهر التالي')}
                onChange={date => { if (!date) return; if (editing==='checkin') {setStart(date);setEnd(null);setEditing('checkout');} else {setEnd(date);} }} />
            <div className="pillow-calendar-footer"><output>{nightsLabel || (editing==='checkin' ? L[2] : L[3])}</output><button type="button" className="pillow-primary" disabled={!nights || nights < 1 || end > latestCheckoutDate(start)} onClick={confirm}>{L[0]}</button></div>
            </div>}
        </SearchDialog>}
    </fieldset>;
}
