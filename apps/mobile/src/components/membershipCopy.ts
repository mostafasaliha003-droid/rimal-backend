import type { MemberState } from '../api/membership';

export const statusText: Record<MemberState, [string, string]> = {
  draft: ['طلب غير مكتمل', 'Draft application'], submitted: ['تم إرسال طلب العضوية', 'Application submitted'],
  under_review: ['طلبك قيد المراجعة', 'Application under review'], needs_information: ['نحتاج إلى معلومات إضافية', 'More information needed'],
  approved: ['عضويتك معتمدة', 'Membership approved'], rejected: ['لم يُعتمد الطلب', 'Application declined'],
  suspended: ['العضوية موقوفة', 'Membership suspended'],
};
