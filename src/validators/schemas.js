const { body, param, query } = require('express-validator');
const { CONDITION_KEYS, VERIFICATION_MODES } = require('../constants/amana');

const loginValidator = [
  body('email').isEmail().withMessage('يرجى إدخال بريد إلكتروني صحيح'),
  body('password').isString().isLength({ min: 6 }).withMessage('كلمة المرور مطلوبة'),
];

const bootstrapAdminValidator = [
  body('name').trim().isLength({ min: 2 }).withMessage('الاسم مطلوب'),
  body('email').isEmail().withMessage('بريد إلكتروني غير صالح'),
  body('phone').trim().isLength({ min: 10 }).withMessage('رقم الهاتف غير صالح'),
  body('password').isString().isLength({ min: 8 }).withMessage('كلمة المرور لا تقل عن 8 أحرف'),
];

const createDistributorValidator = [
  body('name').trim().isLength({ min: 2 }).withMessage('اسم المندوب مطلوب'),
  body('email').isEmail().withMessage('البريد الإلكتروني غير صالح'),
  body('phone').trim().isLength({ min: 10 }).withMessage('رقم الهاتف المصري مطلوب'),
  body('password').isString().isLength({ min: 8 }).withMessage('كلمة المرور لا تقل عن 8 أحرف'),
];

const createBeneficiaryRequestValidator = [
  body('requestType')
    .isIn(['ADD_NEW_BENEFICIARY', 'ADD_CASE_FOR_EXISTING'])
    .withMessage('نوع الطلب غير صالح'),
  body('fullName').optional({ values: 'falsy' }).trim().isLength({ min: 2 }).withMessage('الاسم الكامل مطلوب'),
  body('phone').optional({ values: 'falsy' }).trim().isLength({ min: 10 }).withMessage('رقم الهاتف غير صالح'),
  body('governorate').optional({ values: 'falsy' }).trim().notEmpty().withMessage('المحافظة مطلوبة'),
  body('cityDistrict').optional({ values: 'falsy' }).trim().notEmpty().withMessage('المركز / الحي مطلوب'),
  body('detailedAddress').optional({ values: 'falsy' }).trim().notEmpty().withMessage('العنوان التفصيلي مطلوب'),
  body('conditions').custom((val) => {
    let arr = val;
    if (typeof val === 'string') {
      try {
        arr = JSON.parse(val);
      } catch (_e) {
        arr = val.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('يجب اختيار حالة مستفيد واحدة على الأقل');
    }
    if (arr.some((k) => !CONDITION_KEYS.includes(k))) {
      throw new Error('توجد حالة غير معروفة ضمن القائمة المختارة');
    }
    return true;
  }),
];

const donationValidator = [
  body('amount').isFloat({ gt: 0 }).withMessage('مبلغ التبرع يجب أن يكون أكبر من صفر'),
  body('donationTypeKey').trim().notEmpty().withMessage('نوع التبرع مطلوب'),
  body('paymentMethod').trim().notEmpty().withMessage('طريقة الدفع مطلوبة'),
];

const campaignValidator = [
  body('name').trim().isLength({ min: 2 }).withMessage('اسم الحملة مطلوب'),
  body('assistanceType').trim().notEmpty().withMessage('نوع المساعدة مطلوب'),
  body('startDate').notEmpty().withMessage('تاريخ بداية الحملة مطلوب'),
];

const allocationValidator = [
  body('campaignId').isMongoId().withMessage('معرّف الحملة غير صالح'),
  body('beneficiaryId').isMongoId().withMessage('معرّف المستفيد غير صالح'),
  body('assistanceType').trim().notEmpty().withMessage('نوع المساعدة مطلوب'),
  body('allocatedAmount').isFloat({ gt: 0 }).withMessage('المبلغ المخصص يجب أن يكون أكبر من صفر'),
];

const assignmentValidator = [
  body('distributorId').isMongoId().withMessage('معرّف المندوب غير صالح'),
  body('campaignId').isMongoId().withMessage('معرّف الحملة غير صالح'),
  body('items').isArray({ min: 1 }).withMessage('يجب تحديد مستفيد واحد على الأقل للتكليف'),
];

const custodyTxValidator = [
  body('distributorId').isMongoId().withMessage('معرّف المندوب غير صالح'),
  body('campaignId').isMongoId().withMessage('معرّف الحملة غير صالح'),
  body('amount').isFloat({ gt: 0 }).withMessage('المبلغ يجب أن يكون أكبر من صفر'),
];

const verificationSettingsValidator = [
  body('defaultVerificationMethod').isIn(VERIFICATION_MODES).withMessage('وضع التحقق غير صالح'),
  body('requireAdminApprovalForUnverified').isBoolean().withMessage('قيمة شرط موافقة الإدارة غير صالحة'),
];

const searchQueryValidator = [
  query('q').optional().isString().isLength({ max: 120 }).withMessage('نص البحث طويل جداً'),
  query('page').optional().isInt({ min: 1 }).withMessage('رقم الصفحة غير صالح'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('حد النتائج يجب أن يكون بين 1 و 50'),
];

const mongoIdParamValidator = (name = 'id') => [
  param(name).isMongoId().withMessage(`معرّف (${name}) غير صالح`),
];

module.exports = {
  loginValidator,
  bootstrapAdminValidator,
  createDistributorValidator,
  createBeneficiaryRequestValidator,
  donationValidator,
  campaignValidator,
  allocationValidator,
  assignmentValidator,
  custodyTxValidator,
  verificationSettingsValidator,
  searchQueryValidator,
  mongoIdParamValidator,
};
