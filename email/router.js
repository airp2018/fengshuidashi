'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const { normalizeUploadFilename } = require('./filename');
const {
  summarizeEmailOpenEvents,
  summarizeSentEmailEvents,
  isSentEmailRecordForAccount
} = require('./tracking');
const {
  createEmailAccountId,
  buildSmtpConfig,
  buildSmtpTransportOptions
} = require('./account');

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);
const EMAIL_ACCOUNT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function createEmailRouter({ feishu, getAdminPassword, logQueue }) {
  if (!feishu || typeof getAdminPassword !== 'function' || !Array.isArray(logQueue)) {
    throw new Error('Email router dependencies are incomplete.');
  }

  const router = express.Router();
  const emailOpenEvents = new Map();
  const recentSentEmails = [];
  const emailAuthFailures = new Map();
  const emailAccountLoginFailures = new Map();
  const emailAccountSessions = new Map();
  const emailUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
      files: 5,
      fileSize: 20 * 1024 * 1024
    }
  });

  function getEmailClientKey(req) {
    return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
      .split(',')[0]
      .trim();
  }

  function getEmailAccountSession(req, res) {
    const authorization = String(req.headers.authorization || '');
    const match = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i);
    const token = match?.[1] || '';
    const session = token ? emailAccountSessions.get(token) : null;

    if (!session || Date.now() - session.lastSeenAt > EMAIL_ACCOUNT_SESSION_TTL_MS) {
      if (token) emailAccountSessions.delete(token);
      res.status(401).json({ error: 'Unauthorized', message: '邮箱登录已失效，请重新输入授权码。' });
      return null;
    }

    session.lastSeenAt = Date.now();
    return session;
  }

  function getLegacyEmailAccountId() {
    const legacyEmail = String(process.env.SMTP_USER || '').trim();
    return legacyEmail ? createEmailAccountId('163', legacyEmail) : '';
  }

  function createSmtpTransport(smtp) {
    return nodemailer.createTransport(buildSmtpTransportOptions(smtp));
  }

  function getSmtpErrorDetails(error) {
    return {
      name: error?.name || '',
      code: error?.code || '',
      command: error?.command || '',
      errno: error?.errno || '',
      syscall: error?.syscall || '',
      address: error?.address || '',
      port: error?.port || '',
      reason: error?.reason || '',
      message: error?.message || ''
    };
  }

  function getSafeEmailAccount(session) {
    return {
      account_id: session.accountId,
      provider: session.smtp.provider,
      provider_label: session.smtp.provider_label,
      sender: session.smtp.user,
      sender_name: session.senderName
    };
  }

  function authorizeEmailAdmin(req, res) {
    const clientKey = getEmailClientKey(req);
    const now = Date.now();
    const current = emailAuthFailures.get(clientKey) || { count: 0, blockedUntil: 0 };

    if (current.blockedUntil > now) {
      res.status(429).json({ error: 'Too Many Attempts', message: '密码尝试过多，请 15 分钟后再试。' });
      return false;
    }

    const provided = Buffer.from(String(req.headers.authorization || ''));
    const expected = Buffer.from(String(getAdminPassword()));
    const matches = provided.length === expected.length && crypto.timingSafeEqual(provided, expected);

    if (matches) {
      emailAuthFailures.delete(clientKey);
      return true;
    }

    current.count += 1;
    if (current.count >= 5) {
      current.count = 0;
      current.blockedUntil = now + 15 * 60 * 1000;
    }
    emailAuthFailures.set(clientKey, current);
    res.status(401).json({ error: 'Unauthorized', message: '管理密码错误。' });
    return false;
  }

  function getSmtpConfig() {
    const port = Number.parseInt(process.env.SMTP_PORT || '465', 10);
    const secureValue = String(process.env.SMTP_SECURE || 'true').toLowerCase();

    return {
      host: process.env.SMTP_HOST || 'smtp.163.com',
      port: Number.isFinite(port) ? port : 465,
      secure: secureValue !== 'false',
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_AUTH_CODE || process.env.SMTP_PASS || ''
    };
  }

  function escapeEmailHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function getPublicBaseUrl(req) {
    const configuredUrl = process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL;
    return (configuredUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
  }

  router.get('/email/send', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  router.get('/email/open/:trackingId.gif', (req, res) => {
    const trackingId = String(req.params.trackingId || '');

    if (!/^[A-Za-z0-9_-]{8,128}$/.test(trackingId)) {
      return res.status(400).type('text/plain').send('Invalid tracking ID');
    }

    const openedAt = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const clientIp = String(req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress || 'unknown')
      .split(',')[0]
      .trim()
      .slice(0, 120);
    const userAgent = String(req.headers['user-agent'] || '')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 500);
    const requestContext = [
      req.headers.via ? `via=${req.headers.via}` : '',
      req.headers.referer ? `referer=${req.headers.referer}` : '',
      req.headers.accept ? `accept=${req.headers.accept}` : ''
    ]
      .filter(Boolean)
      .join('; ')
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 500);
    const openRecord = {
      created_time: String(Date.now()),
      fields: {
        '设备 ID': `email:${trackingId}`,
        'IP 地址': clientIp,
        '时间': openedAt,
        '事件类型': '邮件跟踪像素加载',
        '测算场景': '投稿邮件',
        '设备环境 (UserAgent)': userAgent,
        '设备尺寸': requestContext
      }
    };
    const liveEvents = emailOpenEvents.get(trackingId) || [];
    liveEvents.push(openRecord);
    if (liveEvents.length > 20) liveEvents.shift();
    emailOpenEvents.set(trackingId, liveEvents);

    logQueue.push({ fields: openRecord.fields });

    res.set({
      'Content-Type': 'image/gif',
      'Content-Length': TRANSPARENT_GIF.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0',
      'X-Robots-Tag': 'noindex, nofollow'
    });
    return res.status(200).send(TRANSPARENT_GIF);
  });

  router.get('/api/email/status', (req, res) => {
    if (!authorizeEmailAdmin(req, res)) return;

    const smtp = getSmtpConfig();
    const senderName = String(process.env.SMTP_SENDER_NAME || '颜桥').trim();
    return res.json({
      smtp_configured: Boolean(smtp.user && smtp.pass),
      sender: smtp.user || null,
      sender_name: senderName || '颜桥'
    });
  });

  router.post('/api/email/account/login', async (req, res) => {
    const clientKey = getEmailClientKey(req);
    const now = Date.now();
    const current = emailAccountLoginFailures.get(clientKey) || { count: 0, blockedUntil: 0 };
    if (current.blockedUntil > now) {
      return res.status(429).json({
        error: 'Too Many Attempts',
        message: '邮箱连接失败次数过多，请 15 分钟后再试。'
      });
    }

    let smtp;
    try {
      smtp = buildSmtpConfig(req.body);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid Email Account', message: error.message });
    }

    const senderName = String(req.body.sender_name || smtp.user.split('@')[0] || '发件人')
      .trim()
      .slice(0, 60);
    const transporter = createSmtpTransport(smtp);
    try {
      await transporter.verify();
      emailAccountLoginFailures.delete(clientKey);
      for (const [existingToken, existingSession] of emailAccountSessions) {
        if (now - existingSession.lastSeenAt > EMAIL_ACCOUNT_SESSION_TTL_MS) {
          emailAccountSessions.delete(existingToken);
        }
      }

      const token = crypto.randomBytes(32).toString('hex');
      const session = {
        accountId: createEmailAccountId(smtp.provider, smtp.user),
        smtp,
        senderName: senderName || '发件人',
        createdAt: now,
        lastSeenAt: now
      };
      emailAccountSessions.set(token, session);
      return res.json({
        success: true,
        token,
        ...getSafeEmailAccount(session)
      });
    } catch (error) {
      current.count += 1;
      if (current.count >= 5) {
        current.count = 0;
        current.blockedUntil = now + 15 * 60 * 1000;
      }
      emailAccountLoginFailures.set(clientKey, current);
      console.error('[Email Account Login Error]', getSmtpErrorDetails(error));
      return res.status(401).json({
        error: 'SMTP Authentication Failed',
        message: '邮箱连接失败，请检查邮箱地址、授权码和服务商。'
      });
    } finally {
      if (typeof transporter.close === 'function') transporter.close();
    }
  });

  router.get('/api/email/account/status', (req, res) => {
    const session = getEmailAccountSession(req, res);
    if (!session) return;
    return res.json({ success: true, ...getSafeEmailAccount(session) });
  });

  router.post('/api/email/account/logout', (req, res) => {
    const authorization = String(req.headers.authorization || '');
    const match = authorization.match(/^Bearer\s+([a-f0-9]{64})$/i);
    if (match) emailAccountSessions.delete(match[1]);
    return res.json({ success: true });
  });

  router.get('/api/email/tracking/:trackingId', async (req, res) => {
    const session = getEmailAccountSession(req, res);
    if (!session) return;

    const trackingId = String(req.params.trackingId || '');
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(trackingId)) {
      return res.status(400).json({ error: 'Invalid Tracking ID', message: '跟踪编号格式不正确。' });
    }

    try {
      const persistedRecords = await feishu.findEmailTrackingEvents(trackingId);
      const liveOpenRecords = emailOpenEvents.get(trackingId) || [];
      const liveSentRecords = recentSentEmails.filter(
        record => record?.fields?.['设备 ID'] === `email:${trackingId}`
      );
      const allRecords = [
        ...liveSentRecords,
        ...liveOpenRecords,
        ...persistedRecords
      ];
      const ownsTrackingId = allRecords.some(record =>
        String(record?.fields?.['事件类型'] || '').startsWith('投稿邮件已发送')
        && isSentEmailRecordForAccount(
          record,
          session.accountId,
          getLegacyEmailAccountId()
        )
      );
      if (!ownsTrackingId) {
        return res.status(404).json({
          error: 'Tracking Record Not Found',
          message: '未找到当前邮箱的跟踪记录。'
        });
      }
      const status = summarizeEmailOpenEvents([...allRecords]);

      return res.json({
        tracking_id: trackingId,
        ...status
      });
    } catch (error) {
      console.error('[Email Tracking Query Error]', error.message);
      return res.status(502).json({
        error: 'Tracking Query Failed',
        message: '暂时无法查询跟踪记录，请稍后再试。'
      });
    }
  });

  router.get('/api/email/sent', async (req, res) => {
    const session = getEmailAccountSession(req, res);
    if (!session) return;

    try {
      const persisted = await feishu.findSentEmailEvents();
      return res.json({
        items: summarizeSentEmailEvents([...recentSentEmails, ...persisted], 100, {
          account_id: session.accountId,
          legacy_account_id: getLegacyEmailAccountId()
        })
      });
    } catch (error) {
      console.error('[Sent Email Query Error]', error.message);
      return res.status(502).json({
        error: 'Sent Email Query Failed',
        message: '暂时无法读取已发送列表，请稍后再试。'
      });
    }
  });

  router.delete('/api/email/sent', async (req, res) => {
    const session = getEmailAccountSession(req, res);
    if (!session) return;

    try {
      const legacyAccountId = getLegacyEmailAccountId();
      const ownedTrackingIds = new Set(recentSentEmails
        .filter(record => isSentEmailRecordForAccount(record, session.accountId, legacyAccountId))
        .map(record => String(record?.fields?.['设备 ID'] || '').replace(/^email:/, ''))
        .filter(Boolean));
      const result = await feishu.deleteEmailHistory(session.accountId, legacyAccountId);
      for (const trackingId of result.tracking_ids || []) ownedTrackingIds.add(trackingId);
      for (let index = recentSentEmails.length - 1; index >= 0; index -= 1) {
        if (isSentEmailRecordForAccount(recentSentEmails[index], session.accountId, legacyAccountId)) {
          recentSentEmails.splice(index, 1);
        }
      }
      for (const trackingId of ownedTrackingIds) emailOpenEvents.delete(trackingId);
      for (let index = logQueue.length - 1; index >= 0; index -= 1) {
        const deviceId = String(logQueue[index]?.fields?.['设备 ID'] || '');
        const trackingId = deviceId.startsWith('email:') ? deviceId.slice('email:'.length) : '';
        const isOwnedSentRecord = isSentEmailRecordForAccount(
          logQueue[index],
          session.accountId,
          legacyAccountId
        );
        if (isOwnedSentRecord || ownedTrackingIds.has(trackingId)) logQueue.splice(index, 1);
      }
      return res.json({ success: true, deleted_count: result.deleted_count });
    } catch (error) {
      console.error('[Email History Delete Error]', error.message);
      return res.status(502).json({
        error: 'Email History Delete Failed',
        message: '清空发送记录失败，请稍后再试。'
      });
    }
  });

  router.post('/api/email/send', (req, res) => {
    const session = getEmailAccountSession(req, res);
    if (!session) return;

    emailUpload.array('attachments', 5)(req, res, async (uploadError) => {
      if (uploadError) {
        const message = uploadError.code === 'LIMIT_FILE_SIZE'
          ? '单个附件不能超过 20 MB。'
          : '附件上传失败。';
        return res.status(400).json({ error: 'Attachment Error', message });
      }

      const recipient = String(req.body.recipient || '').trim();
      const recipientLabel = String(req.body.recipient_label || '').trim();
      const subject = String(req.body.subject || '').trim();
      const body = String(req.body.body || '');
      const submissionName = String(req.body.submission_name || '').trim();
      const senderName = session.senderName;
      const trackingEnabled = String(req.body.tracking_enabled || 'true') !== 'false';
      const attachments = req.files || [];
      const totalAttachmentBytes = attachments.reduce((sum, file) => sum + file.size, 0);

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
        return res.status(400).json({ error: 'Invalid Recipient', message: '请输入有效的收件人邮箱。' });
      }
      if (!recipientLabel || recipientLabel.length > 60) {
        return res.status(400).json({
          error: 'Invalid Recipient Label',
          message: '请输入不超过 60 字的投稿对象，例如“钟山”或“收获”。'
        });
      }
      if (!subject || subject.length > 200) {
        return res.status(400).json({ error: 'Invalid Subject', message: '请输入不超过 200 字的邮件主题。' });
      }
      if (!body.trim()) {
        return res.status(400).json({ error: 'Empty Body', message: '邮件正文不能为空。' });
      }
      if (totalAttachmentBytes > 20 * 1024 * 1024) {
        return res.status(400).json({
          error: 'Attachments Too Large',
          message: '全部附件合计不能超过 20 MB。'
        });
      }

      const smtp = session.smtp;
      const trackingId = crypto.randomUUID().replace(/-/g, '');
      const trackingCreatedAt = Date.now();
      const pixelUrl = `${getPublicBaseUrl(req)}/email/open/${trackingId}.gif`;
      const escapedBody = escapeEmailHtml(body).replace(/\r?\n/g, '<br>');
      const pixelHtml = trackingEnabled
        ? `<img src="${pixelUrl}" width="1" height="1" alt="" style="width:1px;height:1px;border:0;">`
        : '';
      const html = [
        '<!doctype html><html><body>',
        `<div style="font-family:Arial,'Microsoft YaHei',sans-serif;font-size:14px;line-height:1.7;color:#222;">${escapedBody}</div>`,
        pixelHtml,
        '</body></html>'
      ].join('');

      const transporter = createSmtpTransport(smtp);

      try {
        await transporter.sendMail({
          from: {
            name: senderName || '颜桥',
            address: smtp.user
          },
          to: recipient,
          subject,
          text: body,
          html,
          attachments: attachments.map(file => ({
            filename: normalizeUploadFilename(file.originalname),
            content: file.buffer,
            contentType: file.mimetype
          }))
        });

        const sentLogRecord = {
          created_time: String(trackingCreatedAt),
          fields: {
            '设备 ID': `email:${trackingId}`,
            'IP 地址': '未记录',
            '时间': new Date(trackingCreatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
            '事件类型': trackingEnabled ? '投稿邮件已发送（跟踪开启）' : '投稿邮件已发送（跟踪关闭）',
            '测算场景': submissionName.slice(0, 100) || subject.slice(0, 100),
            '设备环境 (UserAgent)': '',
            '设备尺寸': JSON.stringify({
              sender_account_id: session.accountId,
              sender_email: smtp.user,
              recipient_label: recipientLabel,
              recipient_email: recipient
            })
          }
        };
        recentSentEmails.unshift(sentLogRecord);
        if (recentSentEmails.length > 100) recentSentEmails.length = 100;

        let historySaved = false;
        try {
          await feishu.batchInsertLogs([{ fields: sentLogRecord.fields }]);
          historySaved = true;
        } catch (historyError) {
          console.error('[Sent Email History Error]', historyError.message);
          logQueue.push({ fields: sentLogRecord.fields });
        }

        return res.json({
          success: true,
          tracking_enabled: trackingEnabled,
          tracking_id: trackingEnabled ? trackingId : null,
          history_saved: historySaved
        });
      } catch (error) {
        console.error('[Email Send Error]', getSmtpErrorDetails(error));
        return res.status(502).json({
          error: 'Email Send Failed',
          message: `邮件发送失败：${error.code || 'SMTP_ERROR'}`
        });
      } finally {
        if (typeof transporter.close === 'function') transporter.close();
      }
    });
  });

  return router;
}

module.exports = {
  createEmailRouter
};
