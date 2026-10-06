'use strict';

const crypto = require('node:crypto');

const SESSION_COOKIE = 'emailAccountSession';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const REMEMBER_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function createSessionCodec(secret) {
  if (!secret) return null;
  const key = crypto.createHash('sha256').update('submission-email-session-v1\0').update(secret).digest();
  return {
    seal(session) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(JSON.stringify(session), 'utf8'), cipher.final()]);
      const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
      if (token.length > 3500) throw new Error('邮箱登录信息过长，无法保存登录状态。');
      return token;
    },
    open(token, now = Date.now()) {
      try {
        if (!/^[A-Za-z0-9_-]{40,3500}$/.test(token || '')) return null;
        const payload = Buffer.from(token, 'base64url');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
        decipher.setAuthTag(payload.subarray(12, 28));
        const data = JSON.parse(Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8'));
        if (!Number.isFinite(data.expiresAt) || data.expiresAt <= now || !data.accountId || !data.smtp?.user || !data.smtp?.pass) return null;
        return data;
      } catch {
        return null;
      }
    }
  };
}

function readSessionCookie(req) {
  const prefix = `${SESSION_COOKIE}=`;
  const part = String(req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
  return part ? part.slice(prefix.length) : '';
}

function sessionCookieOptions(req) {
  return {
    httpOnly: true, sameSite: 'strict', path: '/api/email',
    secure: Boolean(req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https')
  };
}

module.exports = { SESSION_COOKIE, SESSION_TTL_MS, REMEMBER_TTL_MS, createSessionCodec, readSessionCookie, sessionCookieOptions };
