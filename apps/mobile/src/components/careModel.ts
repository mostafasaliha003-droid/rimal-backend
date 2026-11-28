import type { SupportConversation, SupportMessage, SupportTopic } from '../api/support';
import { localeFor } from './format';

/*
 * Pillow Stays care: the words and the shape of a booking's conversation with the team.
 * Nothing here promises a reply time or an outcome the hotel has not given: a request is
 * "sent to the team", a change is "asked of the hotel", and only the team's reply settles it.
 */
export type CareIntent = SupportTopic | 'change';
export const CARE_TOPICS: readonly CareIntent[] = ['booking', 'payment', 'voucher', 'cancellation', 'refund', 'other', 'change'];
export const careIntent = (value: unknown): CareIntent => CARE_TOPICS.find(item => item === value) ?? 'booking';
/** The server's topic for an intent: a change request is a booking conversation. */
export const serverTopic = (intent: CareIntent): SupportTopic => intent === 'change' ? 'booking' : intent;

export function careCopy(language: string) {
  const ar = language === 'ar';
  return {
    brand: ar ? 'عناية مخدة' : 'Pillow Stays care',
    tagline: ar ? 'محادثة خاصة بحجزك مع فريقنا. ما تكتبه هنا يصل للفريق مرتبطاً بحجزك، فلا داعي لإعادة التفاصيل.'
      : 'A private conversation about your booking with our team. What you write arrives linked to the booking, so there is nothing to repeat.',
    promises: ar ? ['مرتبطة بحجزك', 'خاصة بك وحدك', 'الرد يصلك هنا'] : ['Linked to your booking', 'Private to you', 'Replies arrive here'],
    placeholder: ar ? 'اكتب رسالتك…' : 'Write your message…',
    send: ar ? 'إرسال' : 'Send',
    sending: ar ? 'جارٍ الإرسال' : 'Sending',
    failed: ar ? 'لم تُرسل. اضغط لإعادة المحاولة' : 'Not sent. Tap to retry',
    team: ar ? 'فريق مخدة' : 'Pillow Stays team',
    you: ar ? 'أنت' : 'You',
    emptyTitle: ar ? 'كيف نقدر نساعدك؟' : 'How can we help?',
    emptyBody: ar ? 'اختر من الاقتراحات أو اكتب بكلماتك. يرد فريقنا هنا في هذه المحادثة.' : 'Pick a suggestion or write in your own words. Our team replies here, in this conversation.',
    loading: ar ? 'نفتح محادثتك…' : 'Opening your conversation…',
    notYours: ar ? 'لم نجد هذا الحجز في حسابك' : 'We could not find this booking in your account',
    notYoursBody: ar ? 'افتح المحادثة من «رحلاتي» بالحساب الذي حجزت به.' : 'Open the conversation from My trips while signed in to the account you booked with.',
    notConfirmed: ar ? 'المحادثة تفتح بعد تأكيد الفندق' : 'Chat opens once the hotel confirms',
    notConfirmedBody: ar ? 'المحادثة المباشرة متاحة للحجوزات المؤكدة. لأي سؤال قبل التأكيد راسلنا على support@pillowstays.app.'
      : 'Live chat is for confirmed bookings. For anything before confirmation, email support@pillowstays.app.',
    tooLong: (limit: number) => ar ? `الرسالة أطول من ${limit} حرف` : `The message is longer than ${limit} characters`,
    status: {
      open: ar ? 'وصلت رسالتك للفريق' : 'Your message is with the team',
      waiting: ar ? 'ردّ الفريق' : 'The team replied',
      resolved: ar ? 'تم الحل' : 'Resolved',
    },
    reopen: ar ? 'تحتاج شيئاً آخر؟ اكتب وسنعيد فتح المحادثة.' : 'Need anything else? Write and we will pick it up again.',
    today: ar ? 'اليوم' : 'Today',
    yesterday: ar ? 'أمس' : 'Yesterday',
    reference: ar ? 'مرجع الحجز' : 'Booking reference',
  };
}

/** One-tap starters for an empty conversation, by what the guest came for. */
export function quickReplies(intent: CareIntent, language: string): string[] {
  const ar = language === 'ar';
  const sets: Record<CareIntent, [string, string][]> = {
    change: [
      ['أريد تغيير تواريخ إقامتي', 'I would like to change my dates'],
      ['أريد تصحيح اسم الضيف', 'I need to correct the guest name'],
      ['عندي طلب خاص للفندق (وصول متأخر، سرير إضافي…)', 'I have a special request for the hotel (late arrival, extra bed…)'],
    ],
    cancellation: [
      ['أريد إلغاء هذا الحجز', 'I would like to cancel this booking'],
      ['حاولت الإلغاء من التطبيق ولم يكتمل', 'I tried to cancel in the app and it did not complete'],
    ],
    refund: [
      ['متى يصلني المبلغ المسترد؟', 'When will my refund arrive?'],
      ['المبلغ المسترد لا يطابق ما توقعته', 'The refund is not what I expected'],
    ],
    payment: [
      ['دفعت ولم يتأكد الحجز', 'I paid but the booking is not confirmed'],
      ['عندي سؤال عن طريقة الدفع', 'I have a question about the payment'],
    ],
    voucher: [
      ['لا أستطيع تحميل قسيمة الحجز', 'I cannot download the voucher'],
      ['أحتاج القسيمة باسم آخر', 'I need the voucher under another name'],
    ],
    booking: [
      ['أريد تأكيد تفاصيل حجزي', 'I would like to confirm my booking details'],
      ['أريد تعديل حجزي', 'I would like to change my booking'],
      ['عندي سؤال عن الفندق', 'I have a question about the hotel'],
    ],
    other: [['عندي سؤال', 'I have a question']],
  };
  return sets[intent].map(([arabic, english]) => ar ? arabic : english);
}

export type CareRow =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; key: string; message: SupportMessage; first: boolean; last: boolean; time: string };

function dayKey(iso: string) {
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : '';
}

/** Messages grouped by day, with runs from the same side joined (first/last shape the bubble corners). */
export function careRows(messages: readonly SupportMessage[], language: string, now: Date = new Date()): CareRow[] {
  const copy = careCopy(language);
  const today = dayKey(now.toISOString());
  const yesterday = dayKey(new Date(now.getTime() - 86_400_000).toISOString());
  const timeFormat = new Intl.DateTimeFormat(localeFor(language), { hour: 'numeric', minute: '2-digit' });
  const dayFormat = new Intl.DateTimeFormat(localeFor(language), { weekday: 'long', day: 'numeric', month: 'long' });
  const rows: CareRow[] = [];
  let lastDay = '';
  messages.forEach((message, index) => {
    const day = dayKey(message.createdAt);
    if (day && day !== lastDay) {
      const date = new Date(message.createdAt);
      rows.push({ kind: 'day', key: 'day-' + day, label: day === today ? copy.today : day === yesterday ? copy.yesterday : dayFormat.format(date) });
      lastDay = day;
    }
    const previous = messages[index - 1], next = messages[index + 1];
    const sameRun = (other?: SupportMessage) => Boolean(other && other.mine === message.mine && dayKey(other.createdAt) === day);
    rows.push({ kind: 'message', key: message.id, message, first: !sameRun(previous), last: !sameRun(next),
      time: message.createdAt ? timeFormat.format(new Date(message.createdAt)) : '' });
  });
  return rows;
}

/** A message's direction from its first strong letter: Arabic script reads right to left. */
export function messageDirection(body: string): 'rtl' | 'ltr' {
  const strong = body.match(/[A-Za-z\u00C0-\u024F\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/);
  return strong && /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/.test(strong[0]) ? 'rtl' : 'ltr';
}

/** Poll often while a conversation is fresh, then ease off; never while the app is in the background. */
export function carePollDelay(sinceActivityMs: number) {
  return sinceActivityMs < 2 * 60_000 ? 5_000 : sinceActivityMs < 15 * 60_000 ? 15_000 : 30_000;
}

/** The list order for the support screen: unread first, then most recent. */
export function sortConversations(rows: readonly SupportConversation[]) {
  return [...rows].sort((a, b) => Number(b.unread) - Number(a.unread) || Date.parse(b.updatedAt || '0') - Date.parse(a.updatedAt || '0'));
}
