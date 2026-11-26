const express = require('express');
const fs = require('fs');
const { requireAuth, requireRole } = require('../middlewares/auth');
const { loginRateLimiter, otpRateLimiter } = require('../middlewares/rateLimiter');
const { validateRequest } = require('../middlewares/validate');
const { uploadMiddleware, resolveUploadPathSafe } = require('../config/upload');
const {
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
} = require('../validators/schemas');

const authController = require('../controllers/authController');
const beneficiaryController = require('../controllers/beneficiaryController');
const financeController = require('../controllers/financeController');
const distributionController = require('../controllers/distributionController');
const reportController = require('../controllers/reportController');
const { AppError } = require('../utils/errors');

const router = express.Router();

// ─── Auth Routes ──────────────────────────────────────────────────────────────
router.get('/auth/status', authController.getAuthStatus);
router.post('/auth/bootstrap-admin', bootstrapAdminValidator, validateRequest, authController.bootstrapAdmin);
router.post('/auth/login', loginRateLimiter, loginValidator, validateRequest, authController.login);
router.post('/auth/request-password-reset', loginRateLimiter, authController.requestPasswordReset);
router.post('/auth/reset-password', loginRateLimiter, authController.resetPassword);
router.get('/auth/me', requireAuth, authController.getMe);
router.post('/auth/change-password', requireAuth, authController.changePassword);

// ─── Distributors & Users (Admin Only) ────────────────────────────────────────
router.get('/distributors', requireAuth, requireRole('admin'), authController.listDistributors);
router.post(
  '/distributors',
  requireAuth,
  requireRole('admin'),
  createDistributorValidator,
  validateRequest,
  authController.createDistributor
);
router.patch(
  '/distributors/:id',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  authController.updateDistributor
);

// ─── Beneficiaries, Families, Cases & Manual Search ───────────────────────────
router.get(
  '/beneficiaries/search',
  requireAuth,
  searchQueryValidator,
  validateRequest,
  beneficiaryController.searchBeneficiaries
);
router.get('/beneficiaries', requireAuth, requireRole('admin'), beneficiaryController.listBeneficiariesAdmin);
router.post('/beneficiaries', requireAuth, requireRole('admin'), beneficiaryController.createBeneficiaryAdmin);
router.get(
  '/beneficiaries/:id',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.getBeneficiaryDetailsAdmin
);
router.patch(
  '/beneficiaries/:id',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.updateBeneficiaryAdmin
);
router.patch(
  '/beneficiaries/:id/eligibility',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.reviewEligibilityAdmin
);

router.get('/families', requireAuth, requireRole('admin'), beneficiaryController.listFamilies);
router.post(
  '/families/:familyId/members',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('familyId'),
  validateRequest,
  beneficiaryController.addFamilyMember
);
router.delete(
  '/family-members/:memberId',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('memberId'),
  validateRequest,
  beneficiaryController.removeFamilyMemberHistorical
);
router.get('/beneficiary-cases', requireAuth, requireRole('admin'), beneficiaryController.listBeneficiaryCases);

// ─── Distributor Beneficiary Registration Requests ────────────────────────────
router.post(
  '/beneficiary-requests',
  requireAuth,
  requireRole('distributor', 'admin'),
  uploadMiddleware.array('documents', 5),
  createBeneficiaryRequestValidator,
  validateRequest,
  beneficiaryController.submitBeneficiaryRequest
);
router.get('/beneficiary-requests/my-requests', requireAuth, beneficiaryController.listMyRequests);
router.get(
  '/beneficiary-requests/:id',
  requireAuth,
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.getMyRequestById
);
router.patch(
  '/beneficiary-requests/:id/resubmit',
  requireAuth,
  uploadMiddleware.array('documents', 5),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.resubmitRequest
);

// ─── Admin Review Queue for Beneficiary Registration Requests ─────────────────
router.get('/admin/beneficiary-requests', requireAuth, requireRole('admin'), beneficiaryController.listAdminRequests);
router.get(
  '/admin/beneficiary-requests/:id',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.getAdminRequestById
);
router.patch(
  '/admin/beneficiary-requests/:id/under-review',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.markUnderReview
);
router.patch(
  '/admin/beneficiary-requests/:id/request-information',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.requestMoreInfo
);
router.patch(
  '/admin/beneficiary-requests/:id/reject',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.rejectRequest
);
router.patch(
  '/admin/beneficiary-requests/:id/approve',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  beneficiaryController.approveRequest
);

// ─── Donation Types, Donations & Campaigns ────────────────────────────────────
router.get('/donation-types', requireAuth, financeController.listDonationTypes);
router.post('/donation-types', requireAuth, requireRole('admin'), financeController.createDonationType);
router.patch(
  '/donation-types/:id',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  financeController.updateDonationType
);
router.delete(
  '/donation-types/:id',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  financeController.deleteDonationType
);

router.get('/donations', requireAuth, requireRole('admin'), financeController.listDonations);
router.post(
  '/donations',
  requireAuth,
  requireRole('admin'),
  uploadMiddleware.array('documents', 3),
  donationValidator,
  validateRequest,
  financeController.createDonation
);

router.get('/campaigns', requireAuth, financeController.listCampaigns);
router.post(
  '/campaigns',
  requireAuth,
  requireRole('admin'),
  campaignValidator,
  validateRequest,
  financeController.createCampaign
);
router.patch(
  '/campaigns/:id',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  financeController.updateCampaign
);
router.post(
  '/campaigns/:id/fund',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  financeController.fundCampaign
);

// ─── Allocations & Assignments ────────────────────────────────────────────────
router.get('/allocations', requireAuth, requireRole('admin'), financeController.listAllocations);
router.post(
  '/allocations',
  requireAuth,
  requireRole('admin'),
  allocationValidator,
  validateRequest,
  financeController.createAllocation
);

router.get('/assignments', requireAuth, financeController.listAssignments);
router.post(
  '/assignments',
  requireAuth,
  requireRole('admin'),
  assignmentValidator,
  validateRequest,
  financeController.createAssignment
);

// ─── Financial Custody & Ledger ───────────────────────────────────────────────
router.get('/custody/reconciliation', requireAuth, financeController.getCustodyReconciliation);
router.post(
  '/custody/transfer',
  requireAuth,
  requireRole('admin'),
  custodyTxValidator,
  validateRequest,
  financeController.transferCustody
);
router.post(
  '/custody/return',
  requireAuth,
  custodyTxValidator,
  validateRequest,
  financeController.returnCustody
);
router.post(
  '/custody/adjustment',
  requireAuth,
  requireRole('admin'),
  custodyTxValidator,
  validateRequest,
  financeController.recordAdjustment
);

router.get('/financial-ledger', requireAuth, requireRole('admin'), financeController.listFinancialLedger);

// ─── Distributions, Verification, Receipts & Attempts ─────────────────────────
router.get(
  '/disbursements/context/:beneficiaryId',
  requireAuth,
  requireRole('distributor'),
  mongoIdParamValidator('beneficiaryId'),
  validateRequest,
  distributionController.getDistributionContext
);
router.post('/disbursements/start', requireAuth, requireRole('distributor'), distributionController.startDisbursement);
router.post(
  '/disbursements/:id/verify-otp',
  requireAuth,
  requireRole('distributor'),
  otpRateLimiter,
  mongoIdParamValidator('id'),
  validateRequest,
  distributionController.verifyOtp
);
router.post(
  '/disbursements/:id/resend-otp',
  requireAuth,
  requireRole('distributor'),
  otpRateLimiter,
  mongoIdParamValidator('id'),
  validateRequest,
  distributionController.resendOtp
);
router.post(
  '/disbursements/:id/verify-qr',
  requireAuth,
  requireRole('distributor'),
  otpRateLimiter,
  mongoIdParamValidator('id'),
  validateRequest,
  distributionController.verifyQr
);
router.post(
  '/disbursements/:id/confirm-handover',
  requireAuth,
  requireRole('distributor'),
  mongoIdParamValidator('id'),
  validateRequest,
  distributionController.confirmHandover
);
router.post(
  '/disbursements/:id/review-unverified',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  distributionController.reviewUnverified
);
router.post(
  '/disbursements/assignment-items/:assignmentItemId/fail',
  requireAuth,
  requireRole('distributor'),
  mongoIdParamValidator('assignmentItemId'),
  validateRequest,
  distributionController.recordFailedAttempt
);
router.post(
  '/disbursements/:id/exception',
  requireAuth,
  requireRole('distributor'),
  mongoIdParamValidator('id'),
  validateRequest,
  distributionController.requestException
);
router.post(
  '/disbursements/:id/reverse',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('id'),
  validateRequest,
  distributionController.reverseDisbursement
);

router.get('/delivery-attempts', requireAuth, distributionController.listDeliveryAttempts);
router.get('/receipts', requireAuth, distributionController.listReceipts);
router.get('/receipts/verify/:ref', requireAuth, distributionController.getReceiptByReference);
router.get(
  '/receipts/:id/pdf',
  requireAuth,
  mongoIdParamValidator('id'),
  validateRequest,
  distributionController.downloadReceiptPdf
);

// ─── Reports & Exports ────────────────────────────────────────────────────────
router.get('/reports/overview', requireAuth, requireRole('admin'), reportController.getOverview);
router.get('/reports/distributors', requireAuth, requireRole('admin'), reportController.getDistributorsSummary);
router.get(
  '/reports/distributors/:distributorId',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('distributorId'),
  validateRequest,
  reportController.getSingleDistributor
);
router.get('/reports/assistance-types/:type', requireAuth, requireRole('admin'), reportController.getAssistanceTypeReport);
router.get('/reports/distributions', requireAuth, reportController.getDistributionsReport);
router.get(
  '/reports/campaigns/:campaignId',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('campaignId'),
  validateRequest,
  reportController.getCampaignReport
);
router.get(
  '/reports/beneficiaries/:beneficiaryId/history',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('beneficiaryId'),
  validateRequest,
  reportController.getBeneficiaryHistory
);
router.get(
  '/reports/trace/:disbursementId',
  requireAuth,
  requireRole('admin'),
  mongoIdParamValidator('disbursementId'),
  validateRequest,
  reportController.getTraceability
);
router.get('/reports/export/excel', requireAuth, requireRole('admin'), reportController.exportExcel);
router.get('/reports/export/pdf', requireAuth, requireRole('admin'), reportController.exportPdf);

// ─── Audit Logs, Settings & Safe File Serving ─────────────────────────────────
router.get('/audit-logs', requireAuth, requireRole('admin'), authController.listAuditLogs);
router.get('/settings', requireAuth, authController.getSettings);
router.patch(
  '/settings/verification-policy',
  requireAuth,
  requireRole('admin'),
  verificationSettingsValidator,
  validateRequest,
  authController.updateVerificationPolicy
);
router.patch(
  '/settings/distributor-submission-policy',
  requireAuth,
  requireRole('admin'),
  authController.updateDistributorSubmissionPolicy
);

router.get('/uploads/:filename', requireAuth, (req, res, next) => {
  try {
    const filePath = resolveUploadPathSafe(req.params.filename);
    if (!fs.existsSync(filePath)) {
      throw new AppError('الملف غير موجود', 404);
    }
    res.sendFile(filePath);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
