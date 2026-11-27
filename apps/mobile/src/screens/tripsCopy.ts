import type { BookingHistoryStatus } from '../api/bookings';
import type { Language } from '../i18n';
import type { TripBucket, TripFilter } from '../components/tripsModel';

interface TripsCopy {
  title:string; filtersLabel:string;
  filters:Record<TripFilter,string>; groups:Record<TripBucket,string>;
  status:Record<BookingHistoryStatus,string>; statusLabel:string;
  checkin:string; checkout:string; arrivalToday:string; departureToday:string;
  dateUnknown:string; datesIncomplete:string; datesInvalid:string; hotelUnknown:string;
  reference:string; recordedAmount:string; room:string;
  recordDetails:string; recordedStatus:string; supplierStatus:string;
  refresh:string; findStay:string; allTrips:string; help:string; helpHint:string;
  findBooking:string; lookupLabel:string; lookupHint:string; lookupApplied:string; clearLookup:string;
  emptyTitle:string; emptyBody:string; noMatchesTitle:string; noMatchesBody:string;
  loadingTitle:string; loadingBody:string; errorTitle:string; errorBody:string;
  signInTitle:string; signInBody:string; readOnly:string;
  nights:(count:number)=>string; results:(shown:number,total:number)=>string;
}
const en:TripsCopy={
  title:'My trips',filtersLabel:'Filter by stay dates',
  filters:{all:'All',current:'Today',upcoming:'Upcoming',past:'Past',cancelled:'Cancelled',unknown:'Undated'},
  groups:{current:'Today',upcoming:'Upcoming',past:'Past',cancelled:'Cancelled',unknown:'Undated'},
  status:{confirmed:'Confirmed',cancelled:'Cancelled',pending:'Processing',failed:'Unsuccessful',unknown:'Status not confirmed'},
  statusLabel:'Booking status',checkin:'Check-in',checkout:'Check-out',arrivalToday:'Check-in today',departureToday:'Check-out today',
  dateUnknown:'Not supplied',datesIncomplete:'The complete stay dates were not supplied.',datesInvalid:'The stay dates could not be verified. Check this record with support.',hotelUnknown:'Hotel name unavailable',
  reference:'Booking reference',recordedAmount:'Recorded amount',room:'Room',
  recordDetails:'Record details',recordedStatus:'Record status',supplierStatus:'Supplier status',
  refresh:'Refresh trips',findStay:'Find a stay',allTrips:'Show all trips',help:'Get help with a booking',helpHint:'Keep the booking reference ready. Support opens without sending guest details.',
  findBooking:'Find a booking',lookupLabel:'Hotel name or booking reference',lookupHint:'Search these records on this screen. Nothing is sent or saved.',lookupApplied:'Hotel or reference filter applied',clearLookup:'Clear lookup',
  emptyTitle:'No bookings yet',emptyBody:'Find a stay, or refresh if you are expecting a booking.',
  noMatchesTitle:'No matching booking records',noMatchesBody:'Your other booking records are still available. Show all trips to clear the date and lookup filters.',
  loadingTitle:'Loading your trips',loadingBody:'Checking the booking records linked to this account.',
  errorTitle:'Your trips could not be loaded',errorBody:'Try again to check your records. A loading error does not change a booking.',
  signInTitle:'Sign in to view your trips',signInBody:'Booking records are only shown to their account owner.',
  readOnly:'For changes, contact support.',
  nights:count=>`${count} ${count===1?'night':'nights'}`,results:(shown,total)=>`${shown} of ${total} booking records`,
};
const ar:TripsCopy={
  title:'رحلاتي',filtersLabel:'التصفية حسب تواريخ الإقامة',
  filters:{all:'الكل',current:'اليوم',upcoming:'القادمة',past:'السابقة',cancelled:'الملغاة',unknown:'دون تواريخ'},
  groups:{current:'اليوم',upcoming:'القادمة',past:'السابقة',cancelled:'الملغاة',unknown:'دون تواريخ'},
  status:{confirmed:'مؤكّد',cancelled:'ملغى',pending:'قيد المعالجة',failed:'تعذّر التأكيد',unknown:'الحالة غير مؤكّدة'},
  statusLabel:'حالة الحجز',checkin:'الوصول',checkout:'المغادرة',arrivalToday:'الوصول اليوم',departureToday:'المغادرة اليوم',
  dateUnknown:'لم يُحدّد',datesIncomplete:'لم ترد تواريخ الإقامة كاملة.',datesInvalid:'تعذّر التحقق من تواريخ الإقامة. راجع هذا السجل مع الدعم.',hotelUnknown:'اسم الفندق غير متاح',
  reference:'مرجع الحجز',recordedAmount:'المبلغ المسجّل',room:'الغرفة',
  recordDetails:'تفاصيل السجل',recordedStatus:'حالة السجل',supplierStatus:'حالة المورّد',
  refresh:'تحديث الرحلات',findStay:'ابحث عن إقامة',allTrips:'عرض كل الرحلات',help:'المساعدة بشأن حجز',helpHint:'احتفظ بمرجع الحجز. يُفتح الدعم دون إرسال بيانات الضيوف.',
  findBooking:'ابحث عن حجز',lookupLabel:'اسم الفندق أو مرجع الحجز',lookupHint:'بحث داخل السجلات في هذه الشاشة. لا يُرسل النص ولا يُحفظ.',lookupApplied:'تصفية حسب الفندق أو المرجع',clearLookup:'مسح البحث',
  emptyTitle:'لا توجد حجوزات بعد',emptyBody:'ابحث عن إقامة، أو حدّث القائمة إذا كنت تنتظر ظهور حجز.',
  noMatchesTitle:'لا توجد سجلات حجوزات مطابقة',noMatchesBody:'تبقى سجلات حجوزاتك الأخرى متاحة. اعرض كل الرحلات لمسح تصفية التواريخ والبحث.',
  loadingTitle:'جارٍ تحميل رحلاتك',loadingBody:'نتحقق من سجلات الحجوزات المرتبطة بهذا الحساب.',
  errorTitle:'تعذّر تحميل رحلاتك',errorBody:'حاول مجدداً للاطلاع على سجلاتك. لا يؤثر خطأ التحميل على الحجز.',
  signInTitle:'سجّل الدخول لعرض رحلاتك',signInBody:'تُعرض سجلات الحجوزات لصاحب الحساب فقط.',
  readOnly:'لإجراء تغييرات، تواصل مع الدعم.',
  nights:count=>count===1?'ليلة واحدة':count===2?'ليلتان':`${count} ${count>=3&&count<=10?'ليالٍ':'ليلة'}`,
  results:(shown,total)=>`عرض ${shown} من ${total} من سجلات الحجوزات`,
};
export const tripsCopy=(language:Language):TripsCopy=>language==='ar'?ar:en;
