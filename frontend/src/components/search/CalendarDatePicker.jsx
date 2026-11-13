import { forwardRef } from 'react';
import DatePicker from 'react-datepicker';
import { arSA, enUS, es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

// The day button's full-date name includes its visible numeric day as a token.
// Other English date formats and all date parsing/selection stay unchanged.
const accessibleEnglish = {
    ...enUS,
    formatLong: {
        ...enUS.formatLong,
        date: options => !options?.width || options.width === 'full'
            ? 'EEEE, MMMM d, y'
            : enUS.formatLong.date(options),
    },
};

// Calendar code and styles are requested when a guest first uses a date field.
const CalendarDatePicker = forwardRef(function CalendarDatePicker({ language, ...props }, ref) {
    const locale = language === 'es' ? es : language === 'en' ? accessibleEnglish : arSA;
    return <DatePicker ref={ref} {...props} locale={locale} preventOpenOnFocus
        useWeekdaysShort={language === 'ar'}
        previousMonthButtonLabel={props.previousMonthAriaLabel}
        nextMonthButtonLabel={props.nextMonthAriaLabel} />;
});

export default CalendarDatePicker;
