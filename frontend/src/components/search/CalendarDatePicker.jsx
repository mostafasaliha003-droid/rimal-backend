import { forwardRef } from 'react';
import DatePicker from 'react-datepicker';
import { arSA, enUS, es } from 'date-fns/locale';
import 'react-datepicker/dist/react-datepicker.css';

// Calendar code and styles are requested when a guest first uses a date field.
const CalendarDatePicker = forwardRef(function CalendarDatePicker({ language, ...props }, ref) {
    const locale = language === 'es' ? es : language === 'en' ? enUS : arSA;
    return <DatePicker ref={ref} {...props} locale={locale} />;
});

export default CalendarDatePicker;
