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

function normalizeCustomSmtpHost(value) {
  const host = String(value || '').trim().toLowerCase();
  const validHostname =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/;
  const blockedSuffixes = ['.local', '.localhost', '.internal', '.lan', '.home', '.arpa', '.test', '.invalid'];
  if (!validHostname.test(host) || blockedSuffixes.some(suffix => host.endsWith(suffix))) {
    throw new Error('请输入公开邮箱服务商提供的 SMTP 服务器地址。');
  }
  return host;
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

  if (provider === 'custom') {
    const host = normalizeCustomSmtpHost(input?.custom_host);
    const port = Number(input?.custom_port);
    const security = String(input?.custom_security || '').trim().toLowerCase();
    if (![465, 587, 994].includes(port)) {
      throw new Error('自定义 SMTP 端口仅支持 465、587 或 994。');
    }
    if (!['ssl', 'starttls'].includes(security)) {
      throw new Error('请选择 SSL 或 STARTTLS 加密方式。');
    }
    return {
      provider,
      provider_label: '自定义 SMTP',
      host,
      port,
      secure: security === 'ssl',
      require_tls: security === 'starttls',
      user: email,
      pass
    };
  }

  throw new Error('暂不支持该邮箱服务商。');
}

function buildSmtpTransportOptions(smtp) {
  const options = {
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
  if (smtp.require_tls) options.requireTLS = true;
  return options;
}

module.exports = {
  SMTP_PRESETS,
  normalizeEmail,
  createEmailAccountId,
  buildSmtpConfig,
  buildSmtpTransportOptions
};
