const ROLES = {
  ADMIN: 'admin',
  DISTRIBUTOR: 'distributor',
};

const USER_STATUSES = ['active', 'inactive', 'suspended'];

const BENEFICIARY_CONDITIONS = [
  { key: 'poor', labelAr: 'فقير', labelEn: 'Poor' },
  { key: 'low_income', labelAr: 'دخل محدود', labelEn: 'Low Income' },
  { key: 'orphan', labelAr: 'يتيم', labelEn: 'Orphan' },
  { key: 'widow', labelAr: 'أرملة', labelEn: 'Widow' },
  { key: 'divorced_vulnerable', labelAr: 'مطلقة / أولى بالرعاية', labelEn: 'Divorced / Socially Vulnerable' },
  { key: 'chronic_illness', labelAr: 'مرض مزمن', labelEn: 'Chronic Illness' },
  { key: 'disability', labelAr: 'إعاقة', labelEn: 'Disability' },
  { key: 'medical_treatment', labelAr: 'علاج طبي', labelEn: 'Medical Treatment' },
  { key: 'emergency', labelAr: 'ظروف طارئة', labelEn: 'Emergency Circumstances' },
  { key: 'other', labelAr: 'أخرى', labelEn: 'Other' },
];

const CONDITION_KEYS = BENEFICIARY_CONDITIONS.map((c) => c.key);

const ELIGIBILITY_STATUSES = [
  'PENDING_REVIEW',
  'APPROVED',
  'REJECTED',
  'SUSPENDED',
  'REQUIRES_REASSESSMENT',
];

const BENEFICIARY_REQUEST_STATUSES = [
  'PENDING_REVIEW',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'NEEDS_MORE_INFORMATION',
];

const INITIAL_DONATION_TYPES = [
  { key: 'zakat_al_mal', nameAr: 'زكاة المال', nameEn: 'Zakat Al-Mal', restrictedByDefault: true, sortOrder: 1 },
  { key: 'zakat_al_fitr', nameAr: 'زكاة الفطر', nameEn: 'Zakat Al-Fitr', restrictedByDefault: true, sortOrder: 2 },
  { key: 'kaffarah', nameAr: 'كفارة', nameEn: 'Kaffarah', restrictedByDefault: true, sortOrder: 3 },
  { key: 'general_sadaqah', nameAr: 'صدقة عامة', nameEn: 'General Sadaqah', restrictedByDefault: false, sortOrder: 4 },
  { key: 'ramadan_assistance', nameAr: 'مساعدات رمضان', nameEn: 'Ramadan Assistance', restrictedByDefault: true, sortOrder: 5 },
  { key: 'medical_assistance', nameAr: 'مساعدات علاجية', nameEn: 'Medical Assistance', restrictedByDefault: true, sortOrder: 6 },
  { key: 'orphan_assistance', nameAr: 'كفالة الأيتام', nameEn: 'Orphan Assistance', restrictedByDefault: true, sortOrder: 7 },
  { key: 'emergency_assistance', nameAr: 'إغاثة وطوارئ', nameEn: 'Emergency Assistance', restrictedByDefault: true, sortOrder: 8 },
  { key: 'other_donations', nameAr: 'تبرعات أخرى', nameEn: 'Other Donations', restrictedByDefault: false, sortOrder: 9 },
];

const PAYMENT_METHODS = [
  { key: 'cash', labelAr: 'نقدي' },
  { key: 'bank_transfer', labelAr: 'تحويل بنكي' },
  { key: 'instapay', labelAr: 'إنستاباي' },
  { key: 'vodafone_cash', labelAr: 'محفظة إلكترونية' },
  { key: 'check', labelAr: 'شيك' },
];

const CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'cancelled'];

const ALLOCATION_STATUSES = [
  'DRAFT',
  'APPROVED',
  'ASSIGNED',
  'PARTIALLY_DISTRIBUTED',
  'COMPLETED',
  'CANCELLED',
];

const ASSIGNMENT_STATUSES = ['assigned', 'in_progress', 'completed', 'failed', 'reassigned', 'cancelled'];

const DISBURSEMENT_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'REQUIRES_APPROVAL',
  'REJECTED',
  'CANCELLED',
  'REVERSED',
];

const VERIFICATION_MODES = ['NONE', 'OTP', 'QR_CODE'];

const LEDGER_TYPES = [
  'DONATION_RECEIVED',
  'CAMPAIGN_FUNDING',
  'FUND_ALLOCATION',
  'CUSTODY_TRANSFER',
  'BENEFICIARY_DISBURSEMENT',
  'CUSTODY_RETURN',
  'TRANSACTION_REVERSAL',
  'APPROVED_ADJUSTMENT',
];

const CUSTODY_TX_TYPES = [
  'CUSTODY_TRANSFER',
  'BENEFICIARY_DISBURSEMENT',
  'CUSTODY_RETURN',
  'APPROVED_ADJUSTMENT',
  'TRANSACTION_REVERSAL',
];

const EGYPT_GOVERNORATES = [
  'القاهرة',
  'الجيزة',
  'الإسكندرية',
  'الدقهلية',
  'الشرقية',
  'المنوفية',
  'القليوبية',
  'البحيرة',
  'الغربية',
  'بور سعيد',
  'دمياط',
  'الإسماعيلية',
  'السويس',
  'كفر الشيخ',
  'الفيوم',
  'بني سويف',
  'المنيا',
  'أسيوط',
  'سوهاج',
  'قنا',
  'الأقصر',
  'أسوان',
  'البحر الأحمر',
  'الوادي الجديد',
  'مطروح',
  'شمال سيناء',
  'جنوب سيناء',
];

function getConditionLabelAr(key) {
  const found = BENEFICIARY_CONDITIONS.find((c) => c.key === key);
  return found ? found.labelAr : key;
}

function getDonationTypeFallbackLabelAr(key) {
  const found = INITIAL_DONATION_TYPES.find((d) => d.key === key);
  return found ? found.nameAr : key;
}

function formatEGP(amount) {
  const num = Number(amount || 0);
  return `${num.toLocaleString('ar-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ج.م`;
}

module.exports = {
  ROLES,
  USER_STATUSES,
  BENEFICIARY_CONDITIONS,
  CONDITION_KEYS,
  ELIGIBILITY_STATUSES,
  BENEFICIARY_REQUEST_STATUSES,
  INITIAL_DONATION_TYPES,
  PAYMENT_METHODS,
  CAMPAIGN_STATUSES,
  ALLOCATION_STATUSES,
  ASSIGNMENT_STATUSES,
  DISBURSEMENT_STATUSES,
  VERIFICATION_MODES,
  LEDGER_TYPES,
  CUSTODY_TX_TYPES,
  EGYPT_GOVERNORATES,
  getConditionLabelAr,
  getDonationTypeFallbackLabelAr,
  formatEGP,
};
