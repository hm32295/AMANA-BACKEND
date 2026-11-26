const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { queryDetailedDistributions, getSingleDistributorReport, getAssistanceTypeReport } = require('./reportService');

async function buildExcelReportBuffer(queryParams = {}) {
  const reportType = String(queryParams.reportType || 'distributions');
  let title = 'تقرير التوزيعات والمساعدات - منظومة أمانة';
  let rows = [];
  let totalsDelivered = 0;

  if (reportType === 'distributor-detail' && queryParams.distributorId) {
    const rep = await getSingleDistributorReport(queryParams.distributorId, { ...queryParams, page: 1, limit: 100 });
    title = `تقرير المندوب: ${rep.distributor.name} (${rep.distributor.code})`;
    rows = rep.distributions.items;
    totalsDelivered = rep.distributions.totals.totalDeliveredAmount;
  } else if (reportType === 'assistance-type' && queryParams.assistanceType) {
    const rep = await getAssistanceTypeReport(queryParams.assistanceType, { ...queryParams, page: 1, limit: 100 });
    title = `تقرير المساعدات حسب النوع: ${rep.labelAr}`;
    rows = rep.distributions.items;
    totalsDelivered = rep.distributions.totals.totalDeliveredAmount;
  } else {
    const rep = await queryDetailedDistributions({ ...queryParams, page: 1, limit: 100 });
    rows = rep.items;
    totalsDelivered = rep.totals.totalDeliveredAmount;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'AMANA System';
  const ws = wb.addWorksheet('تقرير أمانة', {
    views: [{ rightToLeft: true }],
  });

  ws.mergeCells('A1:J1');
  const titleCell = ws.getCell('A1');
  titleCell.value = title;
  titleCell.font = { size: 14, bold: true, color: { argb: 'FF0F3D6E' } };
  titleCell.alignment = { horizontal: 'right', vertical: 'middle' };

  const headers = [
    'المرجع',
    'التاريخ',
    'المستفيد',
    'المندوب',
    'الحملة',
    'نوع المساعدة',
    'المخصص (ج.م)',
    'المنصرف الفعلي (ج.م)',
    'التحقق',
    'رقم الإيصال',
  ];

  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F3D6E' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  for (const r of rows) {
    const row = ws.addRow([
      r.reference,
      r.date ? new Date(r.date).toISOString().slice(0, 10) : '',
      r.beneficiaryName,
      r.distributorName,
      r.campaignName,
      r.assistanceTypeLabelAr,
      Number(r.allocatedAmount || 0),
      Number(r.deliveredAmount || 0),
      r.verificationMethod,
      r.receiptNumber || '-',
    ]);
    row.getCell(7).numFmt = '#,##0.00 "ج.م"';
    row.getCell(8).numFmt = '#,##0.00 "ج.م"';
  }

  const totalsRow = ws.addRow([
    'الإجمالي',
    '',
    `عدد السجلات: ${rows.length}`,
    '',
    '',
    '',
    rows.reduce((s, r) => s + Number(r.allocatedAmount || 0), 0),
    Number(totalsDelivered),
    '',
    '',
  ]);
  totalsRow.font = { bold: true };
  totalsRow.getCell(7).numFmt = '#,##0.00 "ج.م"';
  totalsRow.getCell(8).numFmt = '#,##0.00 "ج.م"';

  ws.columns.forEach((col) => {
    col.width = 20;
  });

  return wb.xlsx.writeBuffer();
}

async function buildPdfReportBuffer(queryParams = {}) {
  const rep = await queryDetailedDistributions({ ...queryParams, page: 1, limit: 100 });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('AMANA - Distribution & Financial Report', { align: 'left' });
    doc.moveDown(0.5);
    doc.fontSize(10).text(`Generated: ${new Date().toISOString()}`);
    doc.text(`Total Delivered Amount: ${rep.totals.totalDeliveredAmount.toFixed(2)} EGP`);
    doc.text(`Total Records: ${rep.items.length}`);
    doc.moveDown(1);

    for (const r of rep.items) {
      doc
        .fontSize(9)
        .text(
          `${r.reference} | ${r.assistanceType} | Amount: ${r.deliveredAmount.toFixed(2)} EGP | Status: ${r.status} | Receipt: ${r.receiptNumber || '-'}`
        );
    }

    doc.end();
  });
}

async function buildReceiptPdfBuffer(receipt) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A5', margin: 30 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(16).text('AMANA - Electronic Disbursement Receipt', { align: 'center' });
    doc.moveDown(1);
    doc.fontSize(11).text(`Receipt Number: ${receipt.receiptNumber}`);
    doc.text(`Transaction Reference: ${receipt.transactionReference}`);
    doc.text(`Beneficiary: ${receipt.beneficiaryName}`);
    doc.text(`Campaign: ${receipt.campaignName}`);
    doc.text(`Assistance Type: ${receipt.assistanceType}`);
    doc.text(`Amount: ${Number(receipt.amount).toFixed(2)} EGP`);
    doc.text(`Distributor: ${receipt.distributorName}`);
    doc.text(`Verification Method: ${receipt.verificationMethod}`);
    doc.text(`Issued At: ${new Date(receipt.issuedAt).toISOString()}`);
    doc.end();
  });
}

module.exports = {
  buildExcelReportBuffer,
  buildPdfReportBuffer,
  buildReceiptPdfBuffer,
};
