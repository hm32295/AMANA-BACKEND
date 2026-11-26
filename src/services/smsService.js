const { getEnvConfig } = require('../config/env');

let lastMockDeliveryHook = null;

function setMockSmsTestHook(fn) {
  lastMockDeliveryHook = typeof fn === 'function' ? fn : null;
}

async function sendOtpSms({ phone, code, beneficiaryName, expiresMinutes = 3 }) {
  const cfg = getEnvConfig();
  const message = `رمز التحقق الخاص بمساعدة أمانة للمستفيد ${beneficiaryName}: ${code} (صالح لمدة ${expiresMinutes} دقائق - لا تشاركه إلا عند التسليم الفعلي).`;

  // Mock provider is strictly isolated to development/testing; never logs the OTP code.
  if (!cfg.sms.isLiveConfigured) {
    if (lastMockDeliveryHook && cfg.nodeEnv === 'test') {
      lastMockDeliveryHook({ phone, code, beneficiaryName });
    }
    return {
      provider: 'mock_dev',
      gatewayConfigured: false,
      deliveryStatus: 'mock_dispatched_dev_only',
      providerRef: `MOCK-${Date.now()}`,
    };
  }

  if (cfg.sms.provider === 'twilio') {
    const authToken = Buffer.from(`${cfg.sms.apiKey}:${cfg.sms.apiSecret}`).toString('base64');
    const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.sms.apiKey)}/Messages.json`;
    const body = new URLSearchParams({
      To: phone.startsWith('+') ? phone : `+2${phone}`,
      From: cfg.sms.senderId,
      Body: message,
    });
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!resp.ok) {
      throw new Error('تعذر إرسال رسالة OTP عبر مزود Twilio');
    }
    const data = await resp.json();
    return {
      provider: 'twilio',
      gatewayConfigured: true,
      deliveryStatus: data.status || 'queued',
      providerRef: data.sid || '',
    };
  }

  // Generic HTTP SMS provider
  const resp = await fetch(cfg.sms.apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.sms.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: phone,
      senderId: cfg.sms.senderId,
      message,
    }),
  });
  if (!resp.ok) {
    throw new Error('تعذر إرسال رسالة OTP عبر بوابة الرسائل');
  }
  const data = await resp.json().catch(() => ({}));
  return {
    provider: cfg.sms.provider || 'generic_http',
    gatewayConfigured: true,
    deliveryStatus: 'dispatched',
    providerRef: data.messageId || data.id || `SMS-${Date.now()}`,
  };
}

module.exports = {
  sendOtpSms,
  setMockSmsTestHook,
};
