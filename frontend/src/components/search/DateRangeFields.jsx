import { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays } from 'lucide-react';
import DatePicker from 'react-datepicker';
import { addDays, format, startOfDay } from 'date-fns';
import { arSA, enUS, es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';
import { FieldError } from './SearchFeedback';
import { parseSearchDate } from './searchModel';

export default function DateRangeFields({ controller, overlayHost, onOpenChange }) {
    const { t, dates, errors, language, direction, changeDate } = controller;
    const locale = language === 'es' ? es : language === 'en' ? enUS : arSA;
    const CalendarPortal = useCallback(({ children }) => overlayHost ? createPortal(children, overlayHost) : null, [overlayHost]);
    const arrival = parseSearchDate(dates.checkin);
    const departure = parseSearchDate(dates.checkout);
    return <fieldset className="min-w-0 sm:col-span-2 xl:col-span-2">
        <legend className="sr-only">{t('search.stayDates', 'تواريخ الإقامة')}</legend>
        <div className="search-date-fields">
            {['checkin', 'checkout'].map(field => <div key={field} className="min-w-0">
                <div className={`search-field ${errors[field] ? 'search-field-invalid' : ''}`}>
                    <label htmlFor={`search-${field}`} className="search-label">{field === 'checkin' ? t('search.arrival', 'تسجيل الوصول') : t('search.departure', 'تسجيل المغادرة')}</label>
                    <div className="flex min-w-0 items-center gap-2">
                        <CalendarDays size={20} className="shrink-0 text-remal-blue-strong" aria-hidden="true" />
                        <DatePicker id={`search-${field}`} name={field} selected={field === 'checkin' ? arrival : departure}
                            value={dates[field]} onChange={date => changeDate(field, date ? format(date, 'yyyy-MM-dd') : '')}
                            onChangeRaw={event => { if (typeof event?.target?.value === 'string') changeDate(field, event.target.value); }}
                            dateFormat="yyyy-MM-dd" strictParsing locale={locale} autoComplete="off"
                            minDate={field === 'checkin' ? startOfDay(new Date()) : addDays(arrival || startOfDay(new Date()), 1)}
                            startDate={arrival} endDate={departure} selectsStart={field === 'checkin'} selectsEnd={field === 'checkout'}
                            ariaRequired="true" ariaInvalid={String(Boolean(errors[field]))}
                            ariaDescribedBy={errors[field] ? `search-${field}-error` : `search-${field}-hint`}
                            placeholderText={t('search.datePlaceholder', 'سنة-شهر-يوم')}
                            className="search-input" wrapperClassName="date-picker-shell"
                            calendarClassName="premium-datepicker" popperClassName="search-calendar-popper"
                            popperContainer={CalendarPortal} popperProps={{ strategy: 'fixed' }}
                            popperPlacement={direction === 'rtl' ? 'bottom-end' : 'bottom-start'}
                            showPopperArrow={false} enableTabLoop={false}
                            previousMonthAriaLabel={t('search.previousMonth', 'الشهر السابق')} nextMonthAriaLabel={t('search.nextMonth', 'الشهر التالي')}
                            onCalendarOpen={() => onOpenChange(true)} onCalendarClose={() => onOpenChange(false)}
                            onKeyDown={event => { if (event.key === 'Escape') event.stopPropagation(); }} />
                    </div>
                </div>
                <span id={`search-${field}-hint`} className="sr-only">{t('search.dateFormat', 'أدخل التاريخ بصيغة YYYY-MM-DD أو اختره من التقويم.')}</span>
                <FieldError field={field} message={errors[field]} />
            </div>)}
        </div>
    </fieldset>;
}