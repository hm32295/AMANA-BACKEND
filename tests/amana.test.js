const request = require('supertest');
const ExcelJS = require('exceljs');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const { createApp } = require('../src/app');
const { Beneficiary, Family } = require('../src/models');
const { setMockSmsTestHook } = require('../src/services/smsService');
const { normalizeArabicText } = require('../src/utils/arabicSearch');

process.env.NODE_ENV = 'test';

let replSet;
let app;

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  const uri = replSet.getUri('amana_test');
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri);
  app = createApp();
}, 120000);

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
  }
});

describe('AMANA Full-Stack MongoDB Backend Acceptance & Security Suite', () => {
  let adminToken = '';
  let adminId = '';
  let distAToken = '';
  let distAId = '';
  let distBToken = '';
  let distBId = '';

  let kaffarahDonationId = '';
  let zakatDonationId = '';
  let kaffarahCampaignId = '';
  let kaffarahTypeId = '';

  let benReq1Id = '';
  let benReqRejectId = '';
  let approvedBen1Id = '';
  let approvedBen2Id = '';

  let allocation1Id = '';
  let allocation2Id = '';
  let asg1ItemId = '';
  let asg2ItemId = '';
  let dsb1Id = '';
  let lastMockOtp = '';

  test('1. Admin bootstrap, duplicate block, login & RBAC enforcement', async () => {
    const statusRes = await request(app).get('/api/auth/status');
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.data.needsAdminBootstrap).toBe(true);

    const bootRes = await request(app).post('/api/auth/bootstrap-admin').send({
      name: 'أحمد المدير',
      email: 'admin@amana.test',
      phone: '01012345678',
      password: 'AdminStrongPassword123',
    });
    expect(bootRes.status).toBe(201);
    adminToken = bootRes.body.data.token;
    adminId = bootRes.body.data.user.id;

    const dupBoot = await request(app).post('/api/auth/bootstrap-admin').send({
      name: 'مهاجم',
      email: 'hacker@amana.test',
      phone: '01099999999',
      password: 'Password12345',
    });
    expect(dupBoot.status).toBe(409);

    const badLogin = await request(app).post('/api/auth/login').send({
      email: 'admin@amana.test',
      password: 'WrongPassword',
    });
    expect(badLogin.status).toBe(401);

    const distARes = await request(app)
      .post('/api/distributors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'أحمد المندوب',
        email: 'dista@amana.test',
        phone: '01112345678',
        password: 'DistPassword123',
        governorate: 'القاهرة',
      });
    expect(distARes.status).toBe(201);
    distAId = distARes.body.data.id;

    const distBRes = await request(app)
      .post('/api/distributors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'خالد المندوب',
        email: 'distb@amana.test',
        phone: '01212345678',
        password: 'DistPassword123',
        governorate: 'الجيزة',
      });
    expect(distBRes.status).toBe(201);
    distBId = distBRes.body.data.id;

    const loginA = await request(app).post('/api/auth/login').send({
      email: 'dista@amana.test',
      password: 'DistPassword123',
    });
    expect(loginA.status).toBe(200);
    distAToken = loginA.body.data.token;

    const loginB = await request(app).post('/api/auth/login').send({
      email: 'distb@amana.test',
      password: 'DistPassword123',
    });
    expect(loginB.status).toBe(200);
    distBToken = loginB.body.data.token;

    // Inactive distributor blocked from login
    await request(app)
      .patch(`/api/distributors/${distBId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'inactive' });
    const blockedLogin = await request(app).post('/api/auth/login').send({
      email: 'distb@amana.test',
      password: 'DistPassword123',
    });
    expect(blockedLogin.status).toBe(403);
    // Reactivate distB
    await request(app)
      .patch(`/api/distributors/${distBId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'active' });

    // Distributor blocked from admin endpoints
    const forbiddenReport = await request(app)
      .get('/api/reports/overview')
      .set('Authorization', `Bearer ${distAToken}`);
    expect(forbiddenReport.status).toBe(403);
  });

  test('2. Donations (20,000 EGP Kaffarah), configurable types delete protection, and restricted campaign funding', async () => {
    const typesRes = await request(app)
      .get('/api/donation-types')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(typesRes.status).toBe(200);
    const kaffarahType = typesRes.body.data.find((t) => t.key === 'kaffarah');
    expect(kaffarahType).toBeTruthy();
    kaffarahTypeId = kaffarahType._id;

    const d1 = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 20000,
        donationTypeKey: 'kaffarah',
        donorName: 'الحاج محمود',
        paymentMethod: 'bank_transfer',
        description: 'تبرع كفارة يمين',
      });
    expect(d1.status).toBe(201);
    kaffarahDonationId = d1.body.data._id;

    const d2 = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        amount: 10000,
        donationTypeKey: 'zakat_al_mal',
        donorName: 'فاعل خير',
        paymentMethod: 'cash',
      });
    expect(d2.status).toBe(201);
    zakatDonationId = d2.body.data._id;

    // Cannot delete donation type already used in financial records
    const delType = await request(app)
      .delete(`/api/donation-types/${kaffarahTypeId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(delType.status).toBe(409);

    // Create Kaffarah Campaign
    const campRes = await request(app)
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'حملة إطعام وكفارات 2026',
        assistanceType: 'kaffarah',
        allowedDonationCategories: ['kaffarah'],
        startDate: '2026-01-01',
        targetAmount: 20000,
      });
    expect(campRes.status).toBe(201);
    kaffarahCampaignId = campRes.body.data._id;

    // Block funding Kaffarah campaign with Zakat Al-Mal donation
    const badFund = await request(app)
      .post(`/api/campaigns/${kaffarahCampaignId}/fund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ donationId: zakatDonationId, amount: 5000 });
    expect(badFund.status).toBe(400);

    // Fund Kaffarah campaign with 20,000 EGP Kaffarah donation
    const okFund = await request(app)
      .post(`/api/campaigns/${kaffarahCampaignId}/fund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ donationId: kaffarahDonationId, amount: 20000 });
    expect(okFund.status).toBe(201);
  });

  test('3. Distributor beneficiary registration, duplicate detection, request-info/resubmit, admin approval & rejection', async () => {
    // Submit new beneficiary by distributor A with multiple conditions
    const sub1 = await request(app)
      .post('/api/beneficiary-requests')
      .set('Authorization', `Bearer ${distAToken}`)
      .send({
        requestType: 'ADD_NEW_BENEFICIARY',
        fullName: 'محمد أحمد عطوة',
        phone: '01055551111',
        nationalId: '29001011234567',
        governorate: 'القاهرة',
        cityDistrict: 'المطرية',
        detailedAddress: 'شارع التروللي',
        familySize: 4,
        socialCondition: 'أسرة متعففة',
        economicCondition: 'دخل محدود',
        conditions: ['poor', 'orphan'],
        caseDescription: 'يعول أطفالاً أيتاماً',
      });
    expect(sub1.status).toBe(201);
    expect(sub1.body.data.status).toBe('PENDING_REVIEW');
    expect(sub1.body.data.conditions.length).toBe(2);
    benReq1Id = sub1.body.data.id;

    // Distributor CANNOT approve their own submission
    const selfApprove = await request(app)
      .patch(`/api/admin/beneficiary-requests/${benReq1Id}/approve`)
      .set('Authorization', `Bearer ${distAToken}`)
      .send({});
    expect(selfApprove.status).toBe(403);

    // Distributor cannot view other distributor's submission
    const otherView = await request(app)
      .get(`/api/beneficiary-requests/${benReq1Id}`)
      .set('Authorization', `Bearer ${distBToken}`);
    expect(otherView.status).toBe(403);

    // Admin requests more information
    const reqInfo = await request(app)
      .patch(`/api/admin/beneficiary-requests/${benReq1Id}/request-information`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ requestedInfoNotes: 'يرجى تأكيد تفاصيل العنوان' });
    expect(reqInfo.status).toBe(200);
    expect(reqInfo.body.data.status).toBe('NEEDS_MORE_INFORMATION');

    // Distributor resubmits
    const resub = await request(app)
      .patch(`/api/beneficiary-requests/${benReq1Id}/resubmit`)
      .set('Authorization', `Bearer ${distAToken}`)
      .send({
        detailedAddress: 'شارع التروللي - عمارة 12 الدور الثالث',
        distributorNote: 'تم استكمال العنوان التفصيلي',
      });
    expect(resub.status).toBe(200);
    expect(resub.body.data.status).toBe('PENDING_REVIEW');

    // Admin marks UNDER_REVIEW then APPROVES
    const underRev = await request(app)
      .patch(`/api/admin/beneficiary-requests/${benReq1Id}/under-review`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(underRev.status).toBe(200);
    expect(underRev.body.data.status).toBe('UNDER_REVIEW');

    const appRes = await request(app)
      .patch(`/api/admin/beneficiary-requests/${benReq1Id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reviewNotes: 'مستحق ومعتمد بعد المراجعة الميدانية' });
    expect(appRes.status).toBe(200);
    expect(appRes.body.data.request.status).toBe('APPROVED');
    approvedBen1Id = appRes.body.data.beneficiary.id;

    // Duplicate detection when distributor submits matching phone/national ID
    const dupSub = await request(app)
      .post('/api/beneficiary-requests')
      .set('Authorization', `Bearer ${distAToken}`)
      .send({
        requestType: 'ADD_NEW_BENEFICIARY',
        fullName: 'محمد أحمد عطوة المكرر',
        phone: '01055551111',
        nationalId: '29001011234567',
        governorate: 'القاهرة',
        cityDistrict: 'المطرية',
        detailedAddress: 'شارع آخر',
        conditions: ['poor'],
      });
    expect(dupSub.status).toBe(201);
    benReqRejectId = dupSub.body.data.id;

    const adminDupView = await request(app)
      .get(`/api/admin/beneficiary-requests/${benReqRejectId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminDupView.body.data.hasPossibleDuplicate).toBe(true);
    expect(adminDupView.body.data.possibleDuplicates.length).toBeGreaterThan(0);

    // Admin rejects duplicate submission with reason (preserved historically)
    const rejRes = await request(app)
      .patch(`/api/admin/beneficiary-requests/${benReqRejectId}/reject`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rejectionReason: 'طلب مكرر لنفس المستفيد' });
    expect(rejRes.status).toBe(200);
    expect(rejRes.body.data.status).toBe('REJECTED');

    // Distributor submits a new case for existing approved beneficiary
    const addCaseSub = await request(app)
      .post('/api/beneficiary-requests')
      .set('Authorization', `Bearer ${distAToken}`)
      .send({
        requestType: 'ADD_CASE_FOR_EXISTING',
        targetBeneficiaryId: approvedBen1Id,
        conditions: ['medical_treatment'],
        caseDescription: 'توفير علاج شهري',
      });
    expect(addCaseSub.status).toBe(201);
    const approveCase = await request(app)
      .patch(`/api/admin/beneficiary-requests/${addCaseSub.body.data.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(approveCase.status).toBe(200);
    expect(approveCase.body.data.beneficiary.conditions.length).toBe(3);

    // Create a second beneficiary via Admin as PENDING_REVIEW -> verify cannot allocate before approval!
    const ben2Pending = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'محمود عطوة حسن',
        primaryPhone: '01066662222',
        nationalId: '29102021234568',
        governorate: 'الجيزة',
        cityDistrict: 'إمبابة',
        detailedAddress: 'شارع الوحدة',
        conditions: ['widow', 'low_income'],
        eligibilityStatus: 'PENDING_REVIEW',
      });
    expect(ben2Pending.status).toBe(201);
    approvedBen2Id = ben2Pending.body.data.id;

    const blockedAlloc = await request(app)
      .post('/api/allocations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        campaignId: kaffarahCampaignId,
        beneficiaryId: approvedBen2Id,
        assistanceType: 'kaffarah',
        allocatedAmount: 3000,
      });
    expect(blockedAlloc.status).toBe(400);

    // Approve ben2
    const reviewBen2 = await request(app)
      .patch(`/api/beneficiaries/${approvedBen2Id}/eligibility`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ eligibilityStatus: 'APPROVED', decisionReason: 'استحقاق مؤكد' });
    expect(reviewBen2.status).toBe(200);

    // Audit logs recorded review actions
    const logsRes = await request(app)
      .get('/api/audit-logs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(logsRes.status).toBe(200);
    expect(logsRes.body.data.some((l) => l.action === 'BENEFICIARY_REQUEST_APPROVED')).toBe(true);
    expect(logsRes.body.data.some((l) => l.action === 'BENEFICIARY_REQUEST_REJECTED')).toBe(true);
  });

  test('4. Allocations, assignments, custody transfers & strict manual minimal search across 1,050+ beneficiaries', async () => {
    const al1 = await request(app)
      .post('/api/allocations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        campaignId: kaffarahCampaignId,
        beneficiaryId: approvedBen1Id,
        assistanceType: 'kaffarah',
        allocatedAmount: 4000,
      });
    expect(al1.status).toBe(201);
    allocation1Id = al1.body.data._id;

    const al2 = await request(app)
      .post('/api/allocations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        campaignId: kaffarahCampaignId,
        beneficiaryId: approvedBen2Id,
        assistanceType: 'kaffarah',
        allocatedAmount: 3000,
      });
    expect(al2.status).toBe(201);
    allocation2Id = al2.body.data._id;

    const asg1 = await request(app)
      .post('/api/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        distributorId: distAId,
        campaignId: kaffarahCampaignId,
        items: [{ allocationId: allocation1Id, approvedAmount: 4000 }],
      });
    expect(asg1.status).toBe(201);
    asg1ItemId = asg1.body.data.items[0]._id;

    const asg2 = await request(app)
      .post('/api/assignments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        distributorId: distBId,
        campaignId: kaffarahCampaignId,
        items: [{ allocationId: allocation2Id, approvedAmount: 3000 }],
      });
    expect(asg2.status).toBe(201);
    asg2ItemId = asg2.body.data.items[0]._id;

    // Transfer custody 6000 to distA and 5000 to distB
    const trA = await request(app)
      .post('/api/custody/transfer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        distributorId: distAId,
        campaignId: kaffarahCampaignId,
        assistanceType: 'kaffarah',
        amount: 6000,
      });
    expect(trA.status).toBe(201);

    const trB = await request(app)
      .post('/api/custody/transfer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        distributorId: distBId,
        campaignId: kaffarahCampaignId,
        assistanceType: 'kaffarah',
        amount: 5000,
      });
    expect(trB.status).toBe(201);

    // Bulk seed 1,050 extra beneficiaries to test 1,000+ search scale & RBAC isolation
    const sampleFam = await Family.findOne().lean();
    const bulkDocs = [];
    for (let i = 0; i < 1050; i++) {
      const name = `مستفيد إضافي رقم ${i}`;
      bulkDocs.push({
        beneficiaryCode: `BEN-BULK-${String(i).padStart(5, '0')}`,
        familyId: sampleFam._id,
        fullName: name,
        fullNameNormalized: normalizeArabicText(name),
        phone: `010${String(10000000 + i).slice(0, 8)}`,
        governorate: 'القاهرة',
        cityDistrict: 'عين شمس',
        address: 'عنوان اختبار',
        economicSituation: 'دخل محدود',
        socialStatus: 'متزوج',
        conditions: ['poor'],
        eligibilityStatus: 'APPROVED',
        beneficiaryStatus: 'active',
        createdBy: adminId,
      });
    }
    await Beneficiary.insertMany(bulkDocs);

    // Empty query returns empty items (never returns all beneficiaries)
    const emptySearch = await request(app)
      .get('/api/beneficiaries/search?q=&page=1&limit=20')
      .set('Authorization', `Bearer ${distAToken}`);
    expect(emptySearch.status).toBe(200);
    expect(emptySearch.body.data.length).toBe(0);

    // Distributor A partial Arabic search ("مح") returns ONLY approvedBen1Id and ONLY minimal fields!
    const distSearch = await request(app)
      .get(`/api/beneficiaries/search?q=${encodeURIComponent('محمد أحمد')}&page=1&limit=20`)
      .set('Authorization', `Bearer ${distAToken}`);
    expect(distSearch.status).toBe(200);
    expect(distSearch.body.data.length).toBe(1);
    const item = distSearch.body.data[0];
    expect(item.id).toBe(approvedBen1Id);
    expect(item.fullName).toBe('محمد أحمد عطوة');
    expect(Array.isArray(item.conditions)).toBe(true);
    // Strict minimal fields check — NO sensitive fields exposed in search results!
    expect(item.beneficiaryCode).toBeUndefined();
    expect(item.familyCode).toBeUndefined();
    expect(item.phone).toBeUndefined();
    expect(item.nationalId).toBeUndefined();
    expect(item.address).toBeUndefined();
    expect(item.membersCount).toBeUndefined();

    // Distributor A cannot search ben2 (assigned only to Distributor B)
    const distASearchBen2 = await request(app)
      .get(`/api/beneficiaries/search?q=${encodeURIComponent('محمود')}&page=1&limit=20`)
      .set('Authorization', `Bearer ${distAToken}`);
    expect(distASearchBen2.status).toBe(200);
    expect(distASearchBen2.body.data.length).toBe(0);

    // Admin paginated search across 1,050+ records returns capped page size
    const adminScaleSearch = await request(app)
      .get(`/api/beneficiaries/search?q=${encodeURIComponent('مستفيد إضافي')}&page=2&limit=20`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(adminScaleSearch.status).toBe(200);
    expect(adminScaleSearch.body.data.length).toBe(20);
    expect(adminScaleSearch.body.pagination.total).toBe(1050);
  });

  test('5. OTP, QR, NONE verification workflows, failed attempt separation, concurrency protection & receipt generation', async () => {
    // Verify context endpoint exposes only operational distribution data
    const ctxRes = await request(app)
      .get(`/api/disbursements/context/${approvedBen1Id}`)
      .set('Authorization', `Bearer ${distAToken}`);
    expect(ctxRes.status).toBe(200);
    expect(ctxRes.body.data.assignments.length).toBe(1);
    expect(ctxRes.body.data.beneficiary.phone).toBeUndefined();

    // Record a failed delivery attempt first -> must NOT reduce custody or ledger
    const failAttempt = await request(app)
      .post(`/api/disbursements/assignment-items/${asg1ItemId}/fail`)
      .set('Authorization', `Bearer ${distAToken}`)
      .send({ failureReason: 'المستفيد غير متواجد بالمنزل' });
    expect(failAttempt.status).toBe(201);

    // Hook mock SMS to capture OTP
    setMockSmsTestHook(({ code }) => {
      lastMockOtp = code;
    });

    const startRes = await request(app)
      .post('/api/disbursements/start')
      .set('Authorization', `Bearer ${distAToken}`)
      .send({ assignmentItemId: asg1ItemId });
    expect(startRes.status).toBe(201);
    dsb1Id = startRes.body.data.disbursement.id;
    expect(lastMockOtp).toMatch(/^\d{6}$/);

    // Cannot confirm physical handover before verifying OTP
    const prematureHandover = await request(app)
      .post(`/api/disbursements/${dsb1Id}/confirm-handover`)
      .set('Authorization', `Bearer ${distAToken}`)
      .send({ physicalHandoverConfirmed: true });
    expect(prematureHandover.status).toBe(400);

    // Wrong OTP fails cleanly
    const wrongOtp = await request(app)
      .post(`/api/disbursements/${dsb1Id}/verify-otp`)
      .set('Authorization', `Bearer ${distAToken}`)
      .send({ code: '000000' });
    expect(wrongOtp.status).toBe(400);

    // Valid OTP verifies
    const okOtp = await request(app)
      .post(`/api/disbursements/${dsb1Id}/verify-otp`)
      .set('Authorization', `Bearer ${distAToken}`)
      .send({ code: lastMockOtp });
    expect(okOtp.status).toBe(200);

    // Replay OTP is blocked
    const replayOtp = await request(app)
      .post(`/api/disbursements/${dsb1Id}/verify-otp`)
      .set('Authorization', `Bearer ${distAToken}`)
      .send({ code: lastMockOtp });
    expect(replayOtp.status).toBe(400);

    // Concurrent handover race: send two parallel requests -> only 1 completes!
    const [h1, h2] = await Promise.all([
      request(app)
        .post(`/api/disbursements/${dsb1Id}/confirm-handover`)
        .set('Authorization', `Bearer ${distAToken}`)
        .send({ physicalHandoverConfirmed: true }),
      request(app)
        .post(`/api/disbursements/${dsb1Id}/confirm-handover`)
        .set('Authorization', `Bearer ${distAToken}`)
        .send({ physicalHandoverConfirmed: true }),
    ]);
    const statuses = [h1.status, h2.status].sort();
    expect(statuses).toEqual([200, 409]);
    const winner = h1.status === 200 ? h1 : h2;
    expect(winner.body.data.receipt.receiptNumber).toBeTruthy();
    expect(winner.body.data.receipt.beneficiaryName).toBe('محمد أحمد عطوة');

    // Switch verification policy to NONE with requireAdminApprovalForUnverified=false and complete ben2 with distB
    await request(app)
      .patch('/api/settings/verification-policy')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ defaultVerificationMethod: 'NONE', requireAdminApprovalForUnverified: false });

    const start2 = await request(app)
      .post('/api/disbursements/start')
      .set('Authorization', `Bearer ${distBToken}`)
      .send({ assignmentItemId: asg2ItemId });
    expect(start2.status).toBe(201);
    expect(start2.body.data.verification.method).toBe('NONE');

    const handover2 = await request(app)
      .post(`/api/disbursements/${start2.body.data.disbursement.id}/confirm-handover`)
      .set('Authorization', `Bearer ${distBToken}`)
      .send({ physicalHandoverConfirmed: true, idempotencyKey: 'idem-ben2-001' });
    expect(handover2.status).toBe(200);
    expect(handover2.body.data.receipt.verificationMethod).toBe('NONE');
  });

  test('6. Reports, combined Kaffarah+Distributor filter, traceability, reconciliation, reversal & Excel/PDF exports', async () => {
    const overview = await request(app)
      .get('/api/reports/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(overview.status).toBe(200);
    expect(overview.body.data.financialSummary.totalDonations).toBe(30000);
    expect(overview.body.data.financialSummary.totalKaffarah).toBe(20000);
    expect(overview.body.data.financialSummary.netDistributed).toBe(7000);
    expect(overview.body.data.financialSummary.heldByDistributors).toBe(4000); // (6000-4000) + (5000-3000) = 4000
    expect(overview.body.data.financialSummary.reconciliationBalanced).toBe(true);

    // Kaffarah report filtered by distA
    const kaffarahDistA = await request(app)
      .get(`/api/reports/assistance-types/kaffarah?distributorId=${distAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(kaffarahDistA.status).toBe(200);
    expect(kaffarahDistA.body.data.distributions.totals.totalDeliveredAmount).toBe(4000);

    // Traceability drill-down back to original Kaffarah donation
    const trace = await request(app)
      .get(`/api/reports/trace/${dsb1Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(trace.status).toBe(200);
    expect(trace.body.data.originalDonations.length).toBe(1);
    expect(trace.body.data.originalDonations[0].donation.donorName).toBe('الحاج محمود');

    // Excel export & ExcelJS RTL round-trip check
    const excelRes = await request(app)
      .get(`/api/reports/export/excel?reportType=distributor-detail&distributorId=${distAId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(data)));
      });
    expect(excelRes.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(excelRes.body);
    const ws = wb.worksheets[0];
    expect(ws.views[0].rightToLeft).toBe(true);

    // PDF export check
    const pdfRes = await request(app)
      .get('/api/reports/export/pdf')
      .set('Authorization', `Bearer ${adminToken}`)
      .buffer(true)
      .parse((res, cb) => {
        const data = [];
        res.on('data', (chunk) => data.push(chunk));
        res.on('end', () => cb(null, Buffer.concat(data)));
      });
    expect(pdfRes.status).toBe(200);
    expect(pdfRes.body.slice(0, 4).toString()).toBe('%PDF');

    // Reverse dsb1 and verify custody balance & beneficiary history separation
    const revRes = await request(app)
      .post(`/api/disbursements/${dsb1Id}/reverse`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'خطأ في مبلغ الصرف وتصحيح محاسبي' });
    expect(revRes.status).toBe(200);

    const distARepAfter = await request(app)
      .get(`/api/reports/distributors/${distAId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(distARepAfter.body.data.reconciliation.closingBalance).toBe(6000);

    const ben1Hist = await request(app)
      .get(`/api/reports/beneficiaries/${approvedBen1Id}/history`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(ben1Hist.body.data.completedAssistance.length).toBe(0);
    expect(ben1Hist.body.data.nonCompletedAttempts.some((a) => a.status === 'REVERSED')).toBe(true);
  });
});
