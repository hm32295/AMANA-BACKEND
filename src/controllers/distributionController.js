const disbursementService = require('../services/disbursementService');
const custodyLedgerService = require('../services/custodyLedgerService');
const exportService = require('../services/exportService');
const { Receipt, DeliveryAttempt } = require('../models');
const { AppError } = require('../utils/errors');

function reqMeta(req) {
  return { ipAddress: req.ip || '', userAgent: req.get('user-agent') || '' };
}

async function getDistributionContext(req, res, next) {
  try {
    const data = await disbursementService.getDistributorDistributionContext(req.params.beneficiaryId, req.user);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function startDisbursement(req, res, next) {
  try {
    const data = await disbursementService.startDisbursement(req.body.assignmentItemId, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم بدء إجراءات التسليم', data });
  } catch (err) {
    next(err);
  }
}

async function verifyOtp(req, res, next) {
  try {
    const data = await disbursementService.verifyCodeOrQr(req.params.id, 'OTP', req.body.code, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم التحقق من رمز OTP بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function resendOtp(req, res, next) {
  try {
    const data = await disbursementService.resendOtp(req.params.id, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم إعادة إرسال رمز التحقق', data });
  } catch (err) {
    next(err);
  }
}

async function verifyQr(req, res, next) {
  try {
    const data = await disbursementService.verifyCodeOrQr(req.params.id, 'QR_CODE', req.body.token, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم التحقق من رمز QR بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function confirmHandover(req, res, next) {
  try {
    const data = await disbursementService.confirmPhysicalHandover(req.params.id, req.body, req.user, reqMeta(req));
    res.json({
      success: true,
      message: data.awaitingApproval ? 'تم رفع العملية لموافقة الإدارة' : 'تم إتمام الصرف وإصدار الإيصال الإلكتروني بنجاح',
      data,
    });
  } catch (err) {
    next(err);
  }
}

async function reviewUnverified(req, res, next) {
  try {
    const data = await disbursementService.reviewUnverifiedDisbursement(req.params.id, req.body, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم تسجيل قرار الإدارة بنجاح', data });
  } catch (err) {
    next(err);
  }
}

async function recordFailedAttempt(req, res, next) {
  try {
    const data = await disbursementService.recordFailedAttempt(req.params.assignmentItemId, req.body, req.user, reqMeta(req));
    res.status(201).json({ success: true, message: 'تم تسجيل محاولة تسليم متعذرة دون خصم مالي', data });
  } catch (err) {
    next(err);
  }
}

async function requestException(req, res, next) {
  try {
    const data = await disbursementService.requestException(req.params.id, req.body, req.user, reqMeta(req));
    res.json({ success: true, message: 'تم رفع طلب الاستثناء لمراجعة الإدارة', data });
  } catch (err) {
    next(err);
  }
}

async function reverseDisbursement(req, res, next) {
  try {
    const data = await custodyLedgerService.reverseCompletedDisbursement(
      req.params.id,
      req.body.reason,
      req.user,
      reqMeta(req)
    );
    res.json({ success: true, message: 'تم تنفيذ القيد العكسي للعملية مع حفظ سجلها التاريخي', data });
  } catch (err) {
    next(err);
  }
}

async function listReceipts(req, res, next) {
  try {
    const filter = req.user.role === 'distributor' ? { distributorId: req.user.id } : {};
    if (req.query.q) {
      filter.$or = [
        { receiptNumber: { $regex: req.query.q, $options: 'i' } },
        { transactionReference: { $regex: req.query.q, $options: 'i' } },
      ];
    }
    const receipts = await Receipt.find(filter).sort({ issuedAt: -1 }).limit(100).lean();
    res.json({ success: true, data: receipts.map((r) => ({ ...r, id: String(r._id) })) });
  } catch (err) {
    next(err);
  }
}

async function getReceiptByReference(req, res, next) {
  try {
    const receipt = await Receipt.findOne({
      $or: [{ receiptNumber: req.params.ref }, { transactionReference: req.params.ref }],
    }).lean();
    if (!receipt) throw new AppError('الإيصال غير موجود', 404);
    if (req.user.role === 'distributor' && String(receipt.distributorId) !== String(req.user.id)) {
      throw new AppError('ليس لديك صلاحية عرض هذا الإيصال', 403);
    }
    res.json({ success: true, data: receipt });
  } catch (err) {
    next(err);
  }
}

async function downloadReceiptPdf(req, res, next) {
  try {
    const receipt = await Receipt.findById(req.params.id).lean();
    if (!receipt) throw new AppError('الإيصال غير موجود', 404);
    if (req.user.role === 'distributor' && String(receipt.distributorId) !== String(req.user.id)) {
      throw new AppError('غير مصرح', 403);
    }
    const buf = await exportService.buildReceiptPdfBuffer(receipt);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receipt.receiptNumber}.pdf"`);
    res.send(buf);
  } catch (err) {
    next(err);
  }
}

async function listDeliveryAttempts(req, res, next) {
  try {
    const filter = req.user.role === 'distributor' ? { distributorId: req.user.id } : {};
    const items = await DeliveryAttempt.find(filter)
      .populate('beneficiaryId', 'fullName')
      .populate('distributorId', 'name code')
      .sort({ attemptedAt: -1 })
      .limit(100)
      .lean();
    res.json({ success: true, data: items });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getDistributionContext,
  startDisbursement,
  verifyOtp,
  resendOtp,
  verifyQr,
  confirmHandover,
  reviewUnverified,
  recordFailedAttempt,
  requestException,
  reverseDisbursement,
  listReceipts,
  getReceiptByReference,
  downloadReceiptPdf,
  listDeliveryAttempts,
};
