'use strict';

// SMTP provider and account configuration for the standalone email module.
const crypto = require('crypto');

const SMTP_PRESETS = Object.freeze({
  '163': { label: '163邮箱', host: 'smtp.163.com', port: 994, secure: true },
  '126': { label: '126邮箱', host: 'smtp.126.com', port: 465, secure: true },
  qq: { label: 'QQ邮箱', host: 'smtp.qq.com', port: 465, secure: true },
  sina: { label: '新浪邮箱', host: 'smtp.sina.com', port: 465, secure: true },
  gmail: { label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true },
  outlook: { label: 'Outlook', host: 'smtp.office365.com', port: 587, secure: false }
});

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function createEmailAccountId(provider, email) {
  return crypto
    .createHash('sha256')
    .update(`${String(provider || '').trim().toLowerCase()}\n${normalizeEmail(email)}`)
    .digest('hex')
    .slice(0, 24);
}

function buildSmtpConfig(input) {
  const provider = String(input?.provider || '').trim().toLowerCase();
  const email = normalizeEmail(input?.email);
  const pass = String(input?.auth_code || '');
  const preset = SMTP_PRESETS[provider];

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('请输入有效的发件邮箱。');
  }
  if (!pass.trim()) {
    throw new Error('请输入邮箱授权码或应用专用密码。');
  }

  if (preset) {
    return {
      provider,
      provider_label: preset.label,
      host: preset.host,
      port: preset.port,
      secure: preset.secure,
      user: email,
      pass
    };
  }

  throw new Error('暂不支持该邮箱服务商。');
}

function buildSmtpTransportOptions(smtp) {
  return {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: {
      user: smtp.user,
      pass: smtp.pass
    },
    disableFileAccess: true,
    disableUrlAccess: true
  };
}

module.exports = {
  SMTP_PRESETS,
  normalizeEmail,
  createEmailAccountId,
  buildSmtpConfig,
  buildSmtpTransportOptions
};
