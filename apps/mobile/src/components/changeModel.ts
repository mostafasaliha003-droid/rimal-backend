import type { CancellationOffer } from '../api/cancellation';
import { formatMoney } from './format';

/*
 * Changing a confirmed booking. Our hotel supplier offers no "modify booking": new dates or a
 * new room are a new booking, after which the old one is cancelled under its own terms; names
 * and special requests are asked of the hotel by the team. These words say exactly that.
 */
export function changeCopy(language: string) {
  const ar = language === 'ar';
  return {
    title: ar ? 'تعديل حجزك' : 'Change your booking',
    lead: ar ? 'الفنادق لا تعدّل الحجز المؤكد مباشرة، لكننا نوصلك لما تريد بأمان. اختر ما تحب تغييره:'
      : 'Hotels do not edit a confirmed booking directly, but we can still get you what you need, safely. Choose what you would like to change:',
    dates: {
      title: ar ? 'تواريخ أو غرفة أو عدد ضيوف مختلف' : 'Different dates, room or guests',
      body: ar ? 'نرتبها بخطوتين لا تخسر فيهما غرفتك. سعر التواريخ الجديدة يُعرض قبل الدفع وقد يختلف.'
        : 'Two steps, so you never lose your room. The new dates are priced before you pay and may cost more or less.',
      steps: ar ? ['احجز التواريخ الجديدة في الفندق نفسه', 'بعد تأكيدها، ألغِ هذا الحجز']
        : ['Book the new dates at the same hotel', 'Once confirmed, cancel this booking'],
      cta: ar ? 'ابحث عن تواريخ جديدة في الفندق نفسه' : 'Find new dates at the same hotel',
      cancelOld: ar ? 'تأكد الحجز الجديد؟ ألغِ هذا الحجز' : 'New booking confirmed? Cancel this one',
    },
    details: {
      title: ar ? 'الاسم أو طلب خاص للفندق' : 'Guest name or a special request',
      body: ar ? 'يرسل فريقنا طلبك للفندق ويرد عليك هنا في محادثة حجزك.' : 'Our team asks the hotel and replies in your booking’s conversation.',
      examples: ar ? ['تصحيح الاسم', 'وصول متأخر', 'سرير إضافي', 'غرفة لغير المدخنين'] : ['Name correction', 'Late arrival', 'Extra bed', 'Non-smoking room'],
      cta: ar ? 'اكتب طلبك لفريق مخدة' : 'Write to the Pillow Stays team',
      draft: ar ? 'أريد تعديل: ' : 'I would like to change: ',
    },
    other: {
      title: ar ? 'شيء آخر' : 'Something else',
      body: ar ? 'أي سؤال عن هذا الحجز، فريقنا هنا.' : 'Any question about this booking: our team is here.',
      cta: ar ? 'افتح المحادثة' : 'Open the conversation',
    },
    footnote: ar ? 'الطلبات الخاصة حسب توفر الفندق وموافقته، وقد يطلب الفندق رسوماً تُدفع عنده. لا يتغير شيء في حجزك حتى يؤكده لك فريقنا.'
      : 'Special requests depend on the hotel’s availability and approval, and the hotel may charge for them at the property. Nothing changes in your booking until our team confirms it.',
  };
}

export type ChangeTerms = { tone: 'success' | 'warning' | 'neutral'; text: string; canCancel: boolean };

/** What cancelling the current booking costs right now: the second half of a date change. */
export function changeTerms(offer: CancellationOffer | null, language: string): ChangeTerms {
  const ar = language === 'ar';
  if (!offer || offer.mode === 'checking') return { tone: 'neutral', canCancel: false,
    text: ar ? 'تعذّر قراءة شروط الإلغاء الآن. راجعها من «إلغاء الحجز» قبل حجز تواريخ جديدة.' : 'We could not read the cancellation terms just now. Check them under Cancel booking before booking new dates.' };
  if (offer.mode === 'tracking') return { tone: 'neutral', canCancel: false,
    text: ar ? 'طلب إلغاء هذا الحجز قيد التنفيذ بالفعل.' : 'A cancellation of this booking is already under way.' };
  if (offer.mode === 'support') return { tone: 'neutral', canCancel: false,
    text: ar ? 'إلغاء هذا الحجز يتم عبر فريقنا، فراسلنا قبل حجز تواريخ جديدة.' : 'This booking is cancelled through our team, so message us before booking new dates.' };
  const fee = formatMoney(offer.fee) || '', refund = formatMoney(offer.refund) || '';
  if (Number(offer.fee.amount) === 0) return { tone: 'success', canCancel: true,
    text: ar ? 'إلغاء هذا الحجز مجاني الآن: احجز الجديد ثم ألغِ هذا دون رسوم.' : 'Cancelling this booking is free right now: book the new one, then cancel this at no cost.' };
  if (Number(offer.refund.amount) === 0) return { tone: 'warning', canCancel: false,
    text: ar ? 'لا يُسترد شيء من هذا الحجز إذا ألغيته الآن. راسل فريقنا قبل أي خطوة.' : 'Nothing is refunded if you cancel this booking now. Message our team before taking any step.' };
  return { tone: 'warning', canCancel: true,
    text: ar ? `إلغاء هذا الحجز الآن عليه رسم ${fee}، ويُسترد ${refund}.` : `Cancelling this booking now costs ${fee}; ${refund} is refunded.` };
}
