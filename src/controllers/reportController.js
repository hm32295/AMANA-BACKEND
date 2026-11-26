const reportService = require('../services/reportService');
const exportService = require('../services/exportService');
const { recordAuditLog } = require('../services/auditService');

async function getOverview(req, res, next) {
  try {
    const data = await reportService.getDashboardOverview(req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getDistributorsSummary(req, res, next) {
  try {
    const data = await reportService.getDistributorsSummaryReport(req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getSingleDistributor(req, res, next) {
  try {
    const data = await reportService.getSingleDistributorReport(req.params.distributorId, req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getAssistanceTypeReport(req, res, next) {
  try {
    const data = await reportService.getAssistanceTypeReport(req.params.type, req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getDistributionsReport(req, res, next) {
  try {
    const data = await reportService.queryDetailedDistributions(req.query, req.user);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getCampaignReport(req, res, next) {
  try {
    const data = await reportService.getCampaignReport(req.params.campaignId, req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getBeneficiaryHistory(req, res, next) {
  try {
    const data = await reportService.getBeneficiaryAssistanceHistory(req.params.beneficiaryId, req.query);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function getTraceability(req, res, next) {
  try {
    const data = await reportService.getDisbursementTraceability(req.params.disbursementId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}

async function exportExcel(req, res, next) {
  try {
    const buf = await exportService.buildExcelReportBuffer(req.query);
    await recordAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'REPORT_EXPORTED_EXCEL',
      entityType: 'Report',
      newValues: { query: req.query },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="amana-report.xlsx"');
    res.send(Buffer.from(buf));
  } catch (err) {
    next(err);
  }
}

async function exportPdf(req, res, next) {
  try {
    const buf = await exportService.buildPdfReportBuffer(req.query);
    await recordAuditLog({
      userId: req.user.id,
      userRole: req.user.role,
      action: 'REPORT_EXPORTED_PDF',
      entityType: 'Report',
      newValues: { query: req.query },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="amana-report.pdf"');
    res.send(buf);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getOverview,
  getDistributorsSummary,
  getSingleDistributor,
  getAssistanceTypeReport,
  getDistributionsReport,
  getCampaignReport,
  getBeneficiaryHistory,
  getTraceability,
  exportExcel,
  exportPdf,
};
