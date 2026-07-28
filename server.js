const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const feishu = require('./feishu');
const { normalizeUploadFilename } = require('./email-filename');

// Concurrency locks to prevent double-click duplicate entries
const activeClaims = new Set();

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and parse large JSON bodies (for Base64 images)
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Serve static files from the current directory
app.use(express.static(__dirname));

// Serve the main HTML file at /
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'fengshui_master.html'));
});

// Serve the admin HTML file at /admin or /admin.html
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// Serve the private tracked-email composer.
app.get('/email/send', (req, res) => {
  res.sendFile(path.join(__dirname, 'email_sender.html'));
});

// Helper to load API key from various env.json locations
function getOpenRouterApiKey() {
  if (process.env.OPENROUTER_API_KEY) {
    return process.env.OPENROUTER_API_KEY;
  }
  
  // Try C:\Users\YANQIAO\Documents\Augment\deepseek-tui\env.json (or .env.json)
  const pathsToTry = [
    path.join(__dirname, 'env.json'),
    path.join(__dirname, '..', 'deepseek-tui', 'env.json'),
    path.join(__dirname, '..', 'deepseek-tui', '.env.json'),
    path.join('C:', 'Users', 'YANQIAO', 'Documents', 'Augment', 'deepseek-tui', 'env.json'),
    path.join('C:', 'Users', 'YANQIAO', 'Documents', 'Augment', 'deepseek-tui', '.env.json')
  ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const env = JSON.parse(raw);
        if (env.OPENROUTER_API_KEY) {
          console.log(`[Config] Loaded OPENROUTER_API_KEY from ${p}`);
          return env.OPENROUTER_API_KEY;
        }
      } catch (e) {
        console.error(`Error parsing env file at ${p}:`, e.message);
      }
    }
  }
  return null;
}

// Helper to get admin password from env.json or defaults to 'admin123'
function getAdminPassword() {
  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD;
  }

  const pathsToTry = [
    path.join(__dirname, 'env.json'),
    path.join(__dirname, '..', 'deepseek-tui', 'env.json'),
    path.join(__dirname, '..', 'deepseek-tui', '.env.json'),
    path.join('C:', 'Users', 'YANQIAO', 'Documents', 'Augment', 'deepseek-tui', 'env.json'),
    path.join('C:', 'Users', 'YANQIAO', 'Documents', 'Augment', 'deepseek-tui', '.env.json')
  ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const env = JSON.parse(raw);
        if (env.ADMIN_PASSWORD) {
          return env.ADMIN_PASSWORD;
        }
      } catch (e) {}
    }
  }
  return 'admin123';
}

// Helper to load Gemini API keys from environment or env.json
function getGeminiApiKeys() {
  if (process.env.GEMINI_API_KEYS) {
    try {
      // Try parsing as JSON array
      const parsed = JSON.parse(process.env.GEMINI_API_KEYS);
      if (Array.isArray(parsed)) return parsed;
    } catch (e) {
      // Fallback: split by comma
      return process.env.GEMINI_API_KEYS.split(',').map(k => k.trim()).filter(Boolean);
    }
  }

  const pathsToTry = [
    path.join(__dirname, 'env.json'),
    path.join(__dirname, '..', 'deepseek-tui', 'env.json'),
    path.join(__dirname, '..', 'deepseek-tui', '.env.json'),
    path.join('C:', 'Users', 'YANQIAO', 'Documents', 'Augment', 'deepseek-tui', 'env.json'),
    path.join('C:', 'Users', 'YANQIAO', 'Documents', 'Augment', 'deepseek-tui', '.env.json')
  ];

  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const env = JSON.parse(raw);
        if (env.GEMINI_API_KEYS && Array.isArray(env.GEMINI_API_KEYS)) {
          return env.GEMINI_API_KEYS;
        }
      } catch (e) {}
    }
  }
  return [];
}

// Helper to get active API provider (prioritizing DB override, falling back to env.json, defaulting to 'gemini')
function getApiProvider() {
  // Check local database override first (runtime config)
  try {
    const db = loadDb();
    if (db.system_config && db.system_config.api_provider) {
      return db.system_config.api_provider; // 'gemini' or 'openrouter'
    }
  } catch (e) {}
  
  // Fallback to env.json config or environment variable
  if (process.env.API_PROVIDER) {
    return process.env.API_PROVIDER;
  }

  const pathsToTry = [
    path.join(__dirname, 'env.json'),
    path.join(__dirname, '..', 'deepseek-tui', 'env.json'),
    path.join(__dirname, '..', 'deepseek-tui', '.env.json')
  ];
  for (const p of pathsToTry) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, 'utf-8');
        const env = JSON.parse(raw);
        if (env.API_PROVIDER) {
          return env.API_PROVIDER;
        }
      } catch (e) {}
    }
  }
  return 'gemini'; // Default is now native Gemini
}

// Consistent hashing to map a client UUID to an API key, supporting retry index shift
function getGeminiApiKeyForClient(clientUuid, attempt = 0) {
  const keys = getGeminiApiKeys();
  if (!keys || keys.length === 0) return null;
  
  let hash = 0;
  for (let i = 0; i < clientUuid.length; i++) {
    hash = (hash << 5) - hash + clientUuid.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  
  const startIndex = Math.abs(hash) % keys.length;
  const keyIndex = (startIndex + attempt) % keys.length;
  return keys[keyIndex];
}

// Parse Base64 Data URL to extract mime type and raw base64 data
function parseBase64Image(dataUrl) {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return {
      mimeType: match[1],
      data: match[2]
    };
  }
  return {
    mimeType: 'image/jpeg',
    data: dataUrl
  };
}

// Call Google Gemini API directly with multi-key rotation and retry
async function callNativeGeminiApi(payload, clientUuid) {
  const keys = getGeminiApiKeys();
  if (!keys || keys.length === 0) {
    throw new Error('未配置 GEMINI_API_KEYS。');
  }

  let lastError = null;
  // Try keys in the pool in case of failures/rate limits
  const maxAttempts = keys.length;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const key = getGeminiApiKeyForClient(clientUuid, attempt);
    if (!key) continue;

    console.log(`[Native Gemini] Attempt ${attempt + 1}: calling Gemini API with key ${key.substring(0, 8)}...`);
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${key}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[Native Gemini] Key ${key.substring(0, 8)} returned error: ${response.status} - ${errText}`);
        lastError = new Error(`Gemini API error (Status ${response.status}): ${errText}`);
        continue; // Try next key
      }

      const data = await response.json();
      if (!data.candidates || data.candidates.length === 0) {
        throw new Error(`Gemini response format error: ${JSON.stringify(data)}`);
      }
      
      const contentText = data.candidates[0].content.parts[0].text;
      return contentText;

    } catch (e) {
      console.error(`[Native Gemini] Attempt ${attempt + 1} failed:`, e.message);
      lastError = e;
    }
  }

  throw lastError || new Error('All Gemini API keys in the pool failed.');
}

// Map scene types to encyclopedia files
function getEncyclopediaFile(sceneType) {
  const encDir = path.join(__dirname, 'fengshui_encyclopedia');
  if (!fs.existsSync(encDir)) return null;

  let filename = '';
  switch (sceneType) {
    case '卧室':
      filename = '04_住宅篇_卧室书房.md';
      break;
    case '书房':
      filename = '04_住宅篇_卧室书房.md';
      break;
    case '客厅':
      filename = '03_住宅篇_客厅餐厅.md';
      break;
    case '餐厅':
      filename = '03_住宅篇_客厅餐厅.md';
      break;
    case '厨房':
      filename = '05_住宅篇_厨房卫浴.md';
      break;
    case '卫浴':
      filename = '05_住宅篇_厨房卫浴.md';
      break;
    case '办公室':
      filename = '06_办公篇.md';
      break;
    case '商铺':
      filename = '07_商业篇.md';
      break;
    default:
      filename = 'INDEX.md';
  }

  const fullPath = path.join(encDir, filename);
  if (fs.existsSync(fullPath)) {
    return fs.readFileSync(fullPath, 'utf-8');
  }
  return null;
}

// Local file-based daily rate limiter database path
const DB_FILE = path.join(__dirname, 'limits_db.json');

// Helper to load db
function loadDb() {
  if (!fs.existsSync(DB_FILE)) {
    return { usage: {} };
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error("[DB Error] Failed to load limits_db.json:", e.message);
    return { usage: {} };
  }
}

// Helper to save db
function saveDb(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (e) {
    console.error("[DB Error] Failed to save limits_db.json:", e.message);
  }
}

async function checkRateLimit(req, res, next) {
  const now = new Date();
  const dateKey = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  
  // Extract client UUID and IP
  const clientUuid = req.headers['x-client-uuid'] || req.body.client_uuid || 'unknown-uuid';
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';

  if (req.path === '/api/prescan' || req.path === '/api/analyze') {
    const db = loadDb();
    if (!db.usage) {
      db.usage = {};
    }
    if (!db.usage[dateKey]) {
      db.usage[dateKey] = {};
    }
    
    const uuidCount = db.usage[dateKey][clientUuid] || 0;
    const ipCount = db.usage[dateKey][clientIp] || 0;
    
    // Read dynamic limit: checks if the client has an active unlock tier
    let limit = 6; // default 6 times per day
    let isVip = false;
    if (db.unlocks && db.unlocks[clientUuid]) {
      limit = db.unlocks[clientUuid].limit;
      isVip = true;
    } else {
      // Local cache miss, check Feishu!
      try {
        const check = await feishu.checkUnlockStatus(clientUuid);
        if (check.found && check.status === '已同意') {
          if (!db.unlocks) {
            db.unlocks = {};
          }
          db.unlocks[clientUuid] = {
            limit: check.tier,
            activatedAt: new Date().toISOString(),
            payment_info: check.payment_info,
            approvedVia: 'feishu_sync'
          };
          saveDb(db);
          limit = check.tier;
          isVip = true;
          console.log(`[Feishu Sync] Synced unlock status from Feishu for user ${clientUuid}: ${limit} times`);
        }
      } catch (e) {
        console.error(`[Feishu Sync Error] Failed to sync status for user ${clientUuid}:`, e.message);
      }
    }
    
    if (req.path === '/api/prescan') {
      // VIP 用户仅校验设备 UUID 额度（避免同一公网 IP 干扰）
      // 普通游客同时校验设备 UUID 额度与 IP 额度（严格防刷）
      const isBlocked = isVip ? (uuidCount >= limit) : (uuidCount >= limit || ipCount >= limit);
      
      if (isBlocked) {
        const blockReason = isVip ? `UUID(${uuidCount}) >= Limit(${limit})` : `UUID(${uuidCount}) or IP(${ipCount}) >= Limit(${limit})`;
        console.log(`[Rate Limit] Blocked prescan request for UUID: ${clientUuid}, IP: ${clientIp}. Reason: ${blockReason}`);
        return res.status(429).json({
          error: 'Usage limit reached',
          message: `☯ 您今天的 ${limit} 次测算额度已用完，请明天再来，或随喜赞助以支持我们的服务器运行！`
        });
      }
      
      // Increment counts
      db.usage[dateKey][clientUuid] = uuidCount + 1;
      
      // 仅对非 VIP 游客增加 IP 计数（防止 VIP 刷爆公网 IP 导致同 IP 下的其他游客被无辜拦截）
      if (!isVip) {
        db.usage[dateKey][clientIp] = ipCount + 1;
      }
      saveDb(db);
      
      const ipLogStr = isVip ? `IP: ${clientIp} (VIP免除IP限流)` : `IP: ${clientIp} (${ipCount + 1}/${limit})`;
      console.log(`[Rate Limit] Request allowed. UUID: ${clientUuid} (${uuidCount + 1}/${limit}), ${ipLogStr}`);
    } else if (req.path === '/api/analyze') {
      // If prescan_data is empty/null, they are bypassing prescan (either hack or error fallback), block them if already over limit
      const { prescan_data } = req.body;
      if (!prescan_data) {
        const isBlocked = isVip ? (uuidCount >= limit) : (uuidCount >= limit || ipCount >= limit);
        if (isBlocked) {
          console.log(`[Rate Limit] Blocked direct analyze request for UUID: ${clientUuid}, IP: ${clientIp}. Limit: ${limit}`);
          return res.status(429).json({
            error: 'Usage limit reached',
            message: `☯ 您今天的 ${limit} 次测算额度已用完，请明天再来，或随喜赞助以支持服务器运行！`
          });
        }
      }
    }
  }
  
  next();
}

// POST API to pre-scan the image and get layout + dynamic questions
app.post('/api/prescan', checkRateLimit, async (req, res) => {
  const { image, scene_type, model } = req.body;
  const clientUuid = req.headers['x-client-uuid'] || req.body.client_uuid || 'unknown-uuid';

  if (!image) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  const selectedModel = model || 'google/gemini-2.5-flash-lite';
  console.log(`[Pre-scan] Starting pre-scan for ${scene_type} using model: ${selectedModel}`);

  // Retrieve RAG dictionary contents
  const ragContent = getEncyclopediaFile(scene_type) || '暂无该场景的权威风水小百科规则。';

  const systemInstruction = `你是一位资深的风水与空间陈设布局大师。你的任务是先对用户上传的【${scene_type}】照片进行第一阶段的视觉观察，并根据风水禁忌规则动态生成针对性的澄清提问。`;

  const promptText = `这是用户上传的一张【${scene_type}】照片。
请结合你的风水知识，尤其是以下关于【${scene_type}】的参考百科规则，对照片进行第一阶段的视觉审计：
---
${ragContent}
---

任务要求：
1. 观察图片，列出你能【清楚看到】的家具陈设、光线以及空间物理布局（放到 "detected" 列表中，如：“床头紧靠着一面实墙”、“左侧有一个大窗户，采光良好”、“房门不可见” 等，注意只描述照片中能确切看到的事实，不要瞎猜）。
2. 根据你的风水经验，列出你能【初步判断】的良好布局或风水隐患（放到 "observations" 列表中，如：“镜子正对床侧，容易影响睡眠质量”、“书桌背靠实体墙，符合靠山原则” 等）。
3. 关键的、你从照片中【无法看清/无法确定】但对最终风水审计至关重要的问题。请只提出 1-3 个最具针对性的追问（放到 "questions" 列表中）。
   * ⚠️【绝对禁令（禁止使用拍照者/相机视角）】：你在提问和选项（opts）中，**绝对禁止使用“在拍照者的左边/右边”、“在镜头的后方”、“在您的左边/右边”** 等含糊费解的观察者中心表述。普通人极难回答这种问题。
   * ⚠️【必须使用物与物的相对位置】：你必须以**房间内家具与家具、家具与建筑结构的相对关系**来描述。
     - 错误示例：“房门是在您的左手边还是右手边？”
     - 正确示例：“如果躺在床上，房门是在床的侧面，还是正对着床尾？”
     - 错误示例：“窗户在您的后方吗？”
     - 正确示例：“书桌是背靠着窗户，还是侧面对着窗户？”
     - 错误示例：“电视在您的哪个方位？”
     - 正确示例：“电视机是否正对着沙发？”
4. 输出必须为【严格的 JSON 格式】，不要包含任何 markdown 标记（如 \`\`\`json）。

JSON 格式规范：
{
  "detected": ["能清楚看到的陈设或布局点1", "能清楚看到的陈设或布局点2"],
  "observations": ["初步发现的风水吉凶点1", "初步发现的风水吉凶点2"],
  "questions": [
    {
      "q": "针对性的相对位置追问问题 1 (例如：照片中没拍到门，请问房门是在床的侧边，还是正对床尾？)",
      "key": "door_pos",
      "opts": ["正对床尾", "在床的左侧", "在床的右侧", "在床头背后"]
    }
  ]
}
注意：追问问题必须提供 2-4 个简洁选项（opts），必须以最直观易懂的物与物位置关系进行提问。如果所有要素都已看清，questions 必须为 []。`;

  let apiProvider = getApiProvider();
  let replyText = '';
  let usedFallback = false;

  if (apiProvider === 'gemini') {
    try {
      const imageObj = parseBase64Image(image);
      const geminiPayload = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: promptText
              },
              {
                inlineData: {
                  mimeType: imageObj.mimeType,
                  data: imageObj.data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json"
        },
        systemInstruction: {
          parts: [
            {
              text: systemInstruction
            }
          ]
        }
      };

      replyText = await callNativeGeminiApi(geminiPayload, clientUuid);
      console.log(`[Pre-scan] Received response from Native Gemini successfully.`);
    } catch (geminiError) {
      console.error(`[Pre-scan] Native Gemini API failed (all keys tried). Falling back to OpenRouter! Error:`, geminiError.message);
      usedFallback = true;
      apiProvider = 'openrouter'; // Trigger fallback to OpenRouter
    }
  }

  if (apiProvider === 'openrouter') {
    try {
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) {
        throw new Error('未在 env.json 或环境变量中找到 OPENROUTER_API_KEY。');
      }

      const messages = [
        {
          role: 'system',
          content: systemInstruction
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: promptText
            },
            {
              type: 'image_url',
              image_url: {
                url: image
              }
            }
          ]
        }
      ];

      console.log(`[OpenRouter] Sending pre-scan request to OpenRouter...`);
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'FengShuiMaster Local Prescan'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: messages,
          temperature: 0.3,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API responded with status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      replyText = data.choices[0].message.content.trim();
      console.log(`[OpenRouter] Received pre-scan response successfully.`);

    } catch (openRouterError) {
      console.error(`[Error] Pre-scan failed on both Google Gemini and OpenRouter:`, openRouterError.message);
      return res.status(500).json({ 
        error: 'Pre-scan Failed', 
        message: usedFallback 
          ? `原生谷歌接口调用失败，自动切回 OpenRouter 后同样报错：${openRouterError.message}` 
          : openRouterError.message 
      });
    }
  }

  try {
    if (replyText.startsWith('```')) {
      replyText = replyText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }
    const resultJson = JSON.parse(replyText);
    res.json(resultJson);
  } catch (parseError) {
    console.error(`[Error] Parse response error:`, parseError.message, 'Reply text was:', replyText);
    res.status(500).json({
      error: 'Parse Response Failed',
      message: '解析模型返回的 JSON 格式失败，请重试。'
    });
  }
});

// POST API to analyze the image
app.post('/api/analyze', checkRateLimit, async (req, res) => {
  const { image, scene_type, orientation, user_answers, prescan_data, model } = req.body;
  const clientUuid = req.headers['x-client-uuid'] || req.body.client_uuid || 'unknown-uuid';

  if (!image) {
    return res.status(400).json({ error: 'Missing image data' });
  }

  const selectedModel = model || 'google/gemini-2.5-flash-lite';
  console.log(`[Analyze] Starting analysis for ${scene_type} using model: ${selectedModel}`);

  // Retrieve RAG dictionary contents
  const ragContent = getEncyclopediaFile(scene_type) || '暂无该场景的权威风水小百科规则。';

  // Construct user Q&A summary
  let qaSummary = '无。';
  if (user_answers && Object.keys(user_answers).length > 0) {
    qaSummary = Object.entries(user_answers)
      .map(([key, val]) => `- ${key}: ${val}`)
      .join('\n');
  }

  // Construct prescan summary
  let prescanSummary = '无。';
  if (prescan_data) {
    const detectedStr = (prescan_data.detected || []).map(x => `- ${x}`).join('\n');
    const obsStr = (prescan_data.observations || []).map(x => `- ${x}`).join('\n');
    prescanSummary = `【第一阶段视觉检测到的陈设】：\n${detectedStr}\n\n【第一阶段初步风水观察】：\n${obsStr}`;
  }

  // Build system & user prompts
  const systemInstruction = `你是一位资深的风水与空间陈设布局大师。请结合用户上传的图片、朝向、预扫描视觉发现以及本地百科规则，对用户的空间进行科学、专业的风水与布局审计。`;

  const promptText = `这是用户上传的一张【${scene_type}】照片。
空间物理朝向（罗盘指向）：【${orientation || '未知'}】

第一阶段 AI 视觉观测到的信息：
${prescanSummary}

用户回答的第二阶段针对性追问细节：
${qaSummary}

下面是关于【${scene_type}】的权威风水小百科参考规则：
---
${ragContent}
---

任务要求：
1. 结合图片、第一阶段的观测、第二阶段用户的解答，检测是否存在任何风水或陈设上的布局合理或不妥之处。
2. 【核心关联性要求】：你作出的每一个风水审计点和改善建议，【必须】结合图片中的具体视觉细节，绝对禁止自说自话或生搬硬套公式化的风水书本套话。每个结论（goods、bads）和建议（tips）中必须详细描述在照片中看到的对应位置/物体细节，使其具有照片专属性。例如：
   - 错误写法：“卧室床头切忌靠窗。”
   - 正确写法：“从照片上可以看到，你的床铺左侧部分正紧靠着白色边框的大飘窗，这形成了床头靠窗的格局，气流直冲容易影响睡眠，建议...”
   - 错误写法：“书桌不可背对大门。”
   - 正确写法：“照片中显示，办公桌上的电脑屏幕正背对着房间的深色木门，这在风水上属于‘背门无靠’，容易让人缺乏安全感，建议...”
3. 计算一个综合评分 (0-100)，布局越合理、煞气越少，分数越高。
4. 归纳出“布局合理的地方 (goods)”、“需要注意的问题 (bads)”，以及具体的“改善建议 (tips)”。
5. 如果照片中没有出现某种家具或陈设（或者不明确），【绝对不能】列入针对该家具的隐患或建议中。
6. 输出必须为【严格的 JSON 格式】，不要包含任何 markdown 标记（如 \`\`\`json）。

JSON 格式规范：
{
  "score": 85,
  "goods": ["好的布局点 1 (需具体提及照片中的位置或物品)", "好的布局点 2 (需具体提及照片中的位置或物品)"],
  "bads": ["需要注意的问题 1 (需具体提及照片中的位置或物品)", "需要注意的问题 2 (需具体提及照片中的位置或物品)"],
  "tips": ["针对问题 1 的具体改善建议 (需结合照片中可以移动或调整的物体)", "针对问题 2 的具体改善建议 (需结合照片中可以移动或调整的物体)"]
}`;

  let apiProvider = getApiProvider();
  let replyText = '';
  let usedFallback = false;

  if (apiProvider === 'gemini') {
    try {
      const imageObj = parseBase64Image(image);
      const geminiPayload = {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: promptText
              },
              {
                inlineData: {
                  mimeType: imageObj.mimeType,
                  data: imageObj.data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: "application/json"
        },
        systemInstruction: {
          parts: [
            {
              text: systemInstruction
            }
          ]
        }
      };

      replyText = await callNativeGeminiApi(geminiPayload, clientUuid);
      console.log(`[Analyze] Received response from Native Gemini successfully.`);
    } catch (geminiError) {
      console.error(`[Analyze] Native Gemini API failed (all keys tried). Falling back to OpenRouter! Error:`, geminiError.message);
      usedFallback = true;
      apiProvider = 'openrouter'; // Trigger fallback to OpenRouter
    }
  }

  if (apiProvider === 'openrouter') {
    try {
      const apiKey = getOpenRouterApiKey();
      if (!apiKey) {
        throw new Error('未在 env.json 或环境变量中找到 OPENROUTER_API_KEY。');
      }

      const messages = [
        {
          role: 'system',
          content: systemInstruction
        },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: promptText
            },
            {
              type: 'image_url',
              image_url: {
                url: image
              }
            }
          ]
        }
      ];

      console.log(`[OpenRouter] Sending request to OpenRouter...`);
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'FengShuiMaster Local'
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: messages,
          temperature: 0.3,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API responded with status ${response.status}: ${errText}`);
      }

      const data = await response.json();
      replyText = data.choices[0].message.content.trim();
      console.log(`[OpenRouter] Received response successfully.`);

    } catch (openRouterError) {
      console.error(`[Error] Analysis failed on both Google Gemini and OpenRouter:`, openRouterError.message);
      return res.status(500).json({ 
        error: 'Analysis Failed', 
        message: usedFallback 
          ? `原生谷歌接口调用失败，自动切回 OpenRouter 后同样报错：${openRouterError.message}` 
          : openRouterError.message 
      });
    }
  }

  try {
    if (replyText.startsWith('```')) {
      replyText = replyText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
    }
    const resultJson = JSON.parse(replyText);
    res.json(resultJson);
  } catch (parseError) {
    console.error(`[Error] Parse response error:`, parseError.message, 'Reply text was:', replyText);
    res.status(500).json({
      error: 'Parse Response Failed',
      message: '解析模型返回的 JSON 格式失败，请重试。'
    });
  }
});

// POST API to activate a redemption code
app.post('/api/activate-code', (req, res) => {
  const { client_uuid, code } = req.body;
  if (!client_uuid || !code) {
    return res.status(400).json({ error: '参数缺失', message: '请提供设备ID和兑换码。' });
  }

  const codesDbPath = path.join(__dirname, 'codes_db.json');
  if (!fs.existsSync(codesDbPath)) {
    return res.status(500).json({ error: 'Database Missing', message: '兑换码数据库不存在。' });
  }

  let codesDb;
  try {
    const raw = fs.readFileSync(codesDbPath, 'utf-8');
    codesDb = JSON.parse(raw);
  } catch (e) {
    return res.status(500).json({ error: 'Database Error', message: '解析兑换码数据库失败。' });
  }

  const codeInfo = codesDb.valid_codes[code];
  if (!codeInfo) {
    return res.status(400).json({ error: 'Invalid Code', message: '无效的兑换码，请重新输入。' });
  }

  if (codeInfo.status !== 'unused') {
    return res.status(400).json({ error: 'Used Code', message: '该兑换码已被使用过。' });
  }

  // Mark code as used
  codeInfo.status = 'used';
  codeInfo.usedBy = client_uuid;
  codeInfo.usedAt = new Date().toISOString();

  // Write back to codes_db.json
  try {
    fs.writeFileSync(codesDbPath, JSON.stringify(codesDb, null, 2), 'utf-8');
  } catch (e) {
    return res.status(500).json({ error: 'Database Write Error', message: '更新兑换码状态失败。' });
  }

  // Update user's unlocked quota in limits_db.json
  const db = loadDb();
  if (!db.unlocks) {
    db.unlocks = {};
  }
  db.unlocks[client_uuid] = {
    limit: codeInfo.limit,
    code: code,
    activatedAt: new Date().toISOString()
  };
  saveDb(db);

  console.log(`[Activation] User ${client_uuid} successfully unlocked limit to ${codeInfo.limit} using code ${code}`);
  return res.json({ success: true, limit: codeInfo.limit });
});

// POST API to claim a code (enters verification queue in Feishu Bitable)
app.post('/api/claim-code', async (req, res) => {
  const { client_uuid, tier, payment_info, cooperation_interest } = req.body;
  const numericTier = parseInt(tier, 10);
  if (!client_uuid || (numericTier !== 50 && numericTier !== 100)) {
    return res.status(400).json({ error: '参数缺失', message: '参数有误。' });
  }

  if (!payment_info || !payment_info.trim()) {
    return res.status(400).json({ error: '参数缺失', message: '请填写打赏付款昵称或单号后4位以供核对。' });
  }

  // 1. 并发锁：防止用户秒级重复双击
  if (activeClaims.has(client_uuid)) {
    return res.status(429).json({ error: 'Concurrency Lock', message: '提交正在处理中，请勿重复点击。' });
  }
  activeClaims.add(client_uuid);

  try {
    const db = loadDb();
    
    // 2. 时间锁：限制 10 分钟内重复提交待审核申请
    if (db.pending_claims && db.pending_claims[client_uuid]) {
      const lastClaim = db.pending_claims[client_uuid];
      if (lastClaim.status === 'pending' && lastClaim.submittedAt) {
        const timeDiffMin = (Date.now() - new Date(lastClaim.submittedAt).getTime()) / 1000 / 60;
        if (timeDiffMin < 10) {
          activeClaims.delete(client_uuid);
          return res.status(400).json({ 
            error: 'Duplicate Limit', 
            message: `您已于 ${Math.round(timeDiffMin)} 分钟前提交过对账申请，请耐心等待管理员审核（通常在几分钟内通过）。10分钟内无需重复提交。` 
          });
        }
      }
    }

    // 3. 提交到飞书多维表格（已防重，相同 UUID 会更新旧记录而不是新增）
    await feishu.addOrUpdatePendingClaim(client_uuid, numericTier, payment_info.trim(), cooperation_interest || '');
    
    // 4. 更新本地缓存记录
    if (!db.pending_claims) {
      db.pending_claims = {};
    }
    db.pending_claims[client_uuid] = {
      tier: numericTier,
      payment_info: payment_info.trim(),
      submittedAt: new Date().toISOString(),
      status: 'pending'
    };
    saveDb(db);

    console.log(`[Claim Pending (Feishu)] User ${client_uuid} submitted payment info for tier ${numericTier}: ${payment_info}`);
    return res.json({ success: true, message: '打赏核对信息已提交至飞书对账系统，请等待人工核对！' });
  } catch (e) {
    console.error('[Feishu Error] Failed to submit claim:', e.message);
    return res.status(500).json({ error: 'Feishu Error', message: '提交记录到飞书失败，请稍后重试。' });
  } finally {
    activeClaims.delete(client_uuid);
  }
});

// GET API to query client's unlock and verification status from Feishu
app.get('/api/check-unlock', async (req, res) => {
  const clientUuid = req.query.client_uuid || 'unknown-uuid';
  const db = loadDb();
  
  // Check local cache first
  if (db.unlocks && db.unlocks[clientUuid]) {
    return res.json({ unlocked: true, limit: db.unlocks[clientUuid].limit });
  }
  
  try {
    const check = await feishu.checkUnlockStatus(clientUuid);
    if (check.found) {
      if (check.status === '已同意') {
        if (!db.unlocks) {
          db.unlocks = {};
        }
        db.unlocks[clientUuid] = {
          limit: check.tier,
          activatedAt: new Date().toISOString(),
          payment_info: check.payment_info,
          approvedVia: 'feishu_sync'
        };
        saveDb(db);
        return res.json({ unlocked: true, limit: check.tier });
      }
      
      // Update local pending claim state
      if (!db.pending_claims) {
        db.pending_claims = {};
      }
      db.pending_claims[clientUuid] = {
        tier: check.tier,
        payment_info: check.payment_info,
        status: check.status === '已拒绝' ? 'rejected' : 'pending'
      };
      saveDb(db);

      return res.json({ 
        unlocked: false, 
        status: check.status === '已拒绝' ? 'rejected' : 'pending',
        payment_info: check.payment_info
      });
    }
    
    return res.json({ unlocked: false, status: 'none' });
  } catch (e) {
    console.error('[Feishu Check Error] Failed to fetch status:', e.message);
    // Fallback to local cache
    if (db.pending_claims && db.pending_claims[clientUuid]) {
      return res.json({ 
        unlocked: false, 
        status: db.pending_claims[clientUuid].status,
        payment_info: db.pending_claims[clientUuid].payment_info
      });
    }
    return res.json({ unlocked: false, status: 'none' });
  }
});

// GET API for Admin panel to list claims and unlocks
app.get('/api/admin/claims', (req, res) => {
  const auth = req.headers['authorization'];
  const expected = getAdminPassword();
  if (auth !== expected) {
    return res.status(401).json({ error: 'Unauthorized', message: '验证密码错误。' });
  }
  
  const db = loadDb();
  const now = new Date();
  const dateKey = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  
  res.json({
    pending_claims: db.pending_claims || {},
    unlocks: db.unlocks || {},
    api_provider: getApiProvider(),
    today_usage: db.usage ? (db.usage[dateKey] || {}) : {},
    date_key: dateKey
  });
});

// POST API for Admin panel to update API provider config
app.post('/api/admin/config', (req, res) => {
  const { password, api_provider } = req.body;
  const expected = getAdminPassword();
  if (password !== expected) {
    return res.status(401).json({ error: 'Unauthorized', message: '验证密码错误。' });
  }

  if (api_provider !== 'gemini' && api_provider !== 'openrouter') {
    return res.status(400).json({ error: 'Invalid Provider', message: '无效的 API 通道值。' });
  }

  const db = loadDb();
  if (!db.system_config) {
    db.system_config = {};
  }
  db.system_config.api_provider = api_provider;
  saveDb(db);

  console.log(`[Admin Config] API Provider changed to: ${api_provider}`);
  res.json({ success: true, api_provider: api_provider });
});

// POST API for Admin action (approve/reject/delete claims)
app.post('/api/admin/action', async (req, res) => {
  const { client_uuid, action, password } = req.body;
  const expected = getAdminPassword();
  if (password !== expected) {
    return res.status(401).json({ error: 'Unauthorized', message: '验证密码错误。' });
  }

  const db = loadDb();
  if (!db.pending_claims || !db.pending_claims[client_uuid]) {
    return res.status(404).json({ error: 'Not Found', message: '未找到该待审核记录。' });
  }

  const claim = db.pending_claims[client_uuid];

  if (action === 'approve') {
    // 同步更新飞书状态为“已同意”
    try {
      await feishu.updateClaimStatusInFeishu(client_uuid, '已同意');
      console.log(`[Feishu Sync] Automatically updated claim status to '已同意' in Feishu Bitable for user ${client_uuid}`);
    } catch (feishuErr) {
      console.error(`[Feishu Sync Error] Failed to update Feishu status on admin approval:`, feishuErr.message);
    }

    claim.status = 'approved';
    claim.reviewedAt = new Date().toISOString();

    if (!db.unlocks) {
      db.unlocks = {};
    }
    
    // Generate a unique code matching database logs for bookkeeping
    const randomHex = Math.random().toString(16).substring(2, 10);
    const code = `fs${claim.tier}_admin_${randomHex}`;
    
    db.unlocks[client_uuid] = {
      limit: claim.tier,
      code: code,
      activatedAt: new Date().toISOString(),
      payment_info: claim.payment_info,
      approvedVia: 'admin_panel'
    };
    
    console.log(`[Admin Action] Approved client ${client_uuid} for tier ${claim.tier}`);
  } else if (action === 'reject') {
    // 同步更新飞书状态为“已拒绝”
    try {
      await feishu.updateClaimStatusInFeishu(client_uuid, '已拒绝');
      console.log(`[Feishu Sync] Automatically updated claim status to '已拒绝' in Feishu Bitable for user ${client_uuid}`);
    } catch (feishuErr) {
      console.error(`[Feishu Sync Error] Failed to update Feishu status on admin rejection:`, feishuErr.message);
    }

    claim.status = 'rejected';
    claim.reviewedAt = new Date().toISOString();
    console.log(`[Admin Action] Rejected client ${client_uuid}`);
  } else if (action === 'delete') {
    delete db.pending_claims[client_uuid];
    console.log(`[Admin Action] Deleted claim record for client ${client_uuid}`);
  }

  saveDb(db);
  return res.json({ success: true });
});

// GET API to query client's current daily limit and usage count
app.get('/api/client-limit', async (req, res) => {
  const clientUuid = req.query.client_uuid || 'unknown-uuid';
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';
  
  const now = new Date();
  const dateKey = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
  
  const db = loadDb();
  let limit = 6;
  let isVip = false;

  if (db.unlocks && db.unlocks[clientUuid]) {
    limit = db.unlocks[clientUuid].limit;
    isVip = true;
  } else {
    // 缓存未命中：直接去飞书查询是否已同意，防止服务器重启清空本地缓存后 VIP 变回 6 次
    try {
      const check = await feishu.checkUnlockStatus(clientUuid);
      if (check.found && check.status === '已同意') {
        if (!db.unlocks) {
          db.unlocks = {};
        }
        db.unlocks[clientUuid] = {
          limit: check.tier,
          activatedAt: new Date().toISOString(),
          payment_info: check.payment_info,
          approvedVia: 'feishu_sync'
        };
        saveDb(db);
        limit = check.tier;
        isVip = true;
        console.log(`[Feishu Sync Limit] Synced unlock status from Feishu for client ${clientUuid}: ${limit} times`);
      }
    } catch (e) {
      console.error(`[Feishu Sync Limit Error] Failed to sync status for client ${clientUuid}:`, e.message);
    }
  }
  
  // Get current usage counts for today
  let uuidCount = 0;
  let ipCount = 0;
  if (db.usage && db.usage[dateKey]) {
    uuidCount = db.usage[dateKey][clientUuid] || 0;
    ipCount = db.usage[dateKey][clientIp] || 0;
  }
  
  // VIP 用户不校验 IP 使用次数，仅游客需要校验最大值
  const currentUsage = isVip ? uuidCount : Math.max(uuidCount, ipCount);
  
  res.json({ 
    limit: limit,
    usage: currentUsage,
    remaining: Math.max(0, limit - currentUsage)
  });
});

const logQueue = [];
const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);
const emailUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 5,
    fileSize: 20 * 1024 * 1024
  }
});
const emailAuthFailures = new Map();

function authorizeEmailAdmin(req, res) {
  const clientKey = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown')
    .split(',')[0]
    .trim();
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

// Lightweight endpoint for uptime checks. Keep this separate from tracking routes.
app.get('/health', (req, res) => {
  res.status(200).type('text/plain').send('OK');
});

// Invisible 1x1 email tracking pixel. Each email should use a unique random ID.
app.get('/email/open/:trackingId.gif', (req, res) => {
  const trackingId = String(req.params.trackingId || '');

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(trackingId)) {
    return res.status(400).type('text/plain').send('Invalid tracking ID');
  }

  logQueue.push({
    fields: {
      "设备 ID": `email:${trackingId}`,
      "IP 地址": '未记录',
      "时间": new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      "事件类型": '邮件跟踪像素加载',
      "测算场景": '投稿邮件',
      "设备环境 (UserAgent)": '',
      "设备尺寸": ''
    }
  });

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

// Verify the admin password and report whether SMTP is ready, without exposing secrets.
app.get('/api/email/status', (req, res) => {
  if (!authorizeEmailAdmin(req, res)) return;

  const smtp = getSmtpConfig();
  return res.json({
    smtp_configured: Boolean(smtp.user && smtp.pass),
    sender: smtp.user || null
  });
});

// Send a multipart text + HTML email and append an optional invisible tracking pixel.
app.post('/api/email/send', (req, res) => {
  if (!authorizeEmailAdmin(req, res)) return;

  emailUpload.array('attachments', 5)(req, res, async (uploadError) => {
    if (uploadError) {
      const message = uploadError.code === 'LIMIT_FILE_SIZE'
        ? '单个附件不能超过 20 MB。'
        : '附件上传失败。';
      return res.status(400).json({ error: 'Attachment Error', message });
    }

    const recipient = String(req.body.recipient || '').trim();
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '');
    const submissionName = String(req.body.submission_name || '').trim();
    const senderName = String(req.body.sender_name || '投稿邮箱').trim().slice(0, 60);
    const trackingEnabled = String(req.body.tracking_enabled || 'true') !== 'false';
    const attachments = req.files || [];
    const totalAttachmentBytes = attachments.reduce((sum, file) => sum + file.size, 0);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      return res.status(400).json({ error: 'Invalid Recipient', message: '请输入有效的收件人邮箱。' });
    }
    if (!subject || subject.length > 200) {
      return res.status(400).json({ error: 'Invalid Subject', message: '请输入不超过 200 字的邮件主题。' });
    }
    if (!body.trim()) {
      return res.status(400).json({ error: 'Empty Body', message: '邮件正文不能为空。' });
    }
    if (totalAttachmentBytes > 20 * 1024 * 1024) {
      return res.status(400).json({ error: 'Attachments Too Large', message: '全部附件合计不能超过 20 MB。' });
    }

    const smtp = getSmtpConfig();
    if (!smtp.user || !smtp.pass) {
      return res.status(503).json({
        error: 'SMTP Not Configured',
        message: '请先在 Render 环境变量中配置 SMTP_USER 和 SMTP_AUTH_CODE。'
      });
    }

    const trackingId = crypto.randomUUID().replace(/-/g, '');
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

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      auth: {
        user: smtp.user,
        pass: smtp.pass
      },
      disableFileAccess: true,
      disableUrlAccess: true
    });

    try {
      await transporter.sendMail({
        from: {
          name: senderName || '投稿邮箱',
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

      logQueue.push({
        fields: {
          "设备 ID": `email:${trackingId}`,
          "IP 地址": '未记录',
          "时间": new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
          "事件类型": trackingEnabled ? '投稿邮件已发送（跟踪开启）' : '投稿邮件已发送（跟踪关闭）',
          "测算场景": submissionName.slice(0, 100) || subject.slice(0, 100),
          "设备环境 (UserAgent)": '',
          "设备尺寸": ''
        }
      });

      return res.json({
        success: true,
        tracking_enabled: trackingEnabled,
        tracking_id: trackingEnabled ? trackingId : null
      });
    } catch (error) {
      console.error('[Email Send Error]', error.code || error.message);
      return res.status(502).json({
        error: 'Email Send Failed',
        message: `邮件发送失败：${error.code || 'SMTP_ERROR'}`
      });
    } finally {
      if (typeof transporter.close === 'function') {
        transporter.close();
      }
    }
  });
});

// POST API to log visit events from client browser
app.post('/api/log-visit', (req, res) => {
  const { client_uuid, event_type, scene, viewport, user_agent } = req.body;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown-ip';

  logQueue.push({
    fields: {
      "设备 ID": client_uuid || 'unknown-uuid',
      "IP 地址": clientIp,
      "时间": new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      "事件类型": event_type || '打开首页',
      "测算场景": scene || '无',
      "设备环境 (UserAgent)": user_agent || '',
      "设备尺寸": viewport || ''
    }
  });

  res.json({ success: true });
});

// Background Sync Worker: Flushes log queue to Feishu Bitable every 10 seconds
setInterval(async () => {
  if (logQueue.length === 0) return;

  const batch = logQueue.splice(0, 100);
  console.log(`[Feishu Log Sync] Syncing ${batch.length} access logs to Bitable...`);

  try {
    await feishu.batchInsertLogs(batch);
    console.log(`[Feishu Log Sync] Successfully synced ${batch.length} logs.`);
  } catch (e) {
    console.error(`[Feishu Log Sync Error] Failed to batch insert logs:`, e.message);
    logQueue.unshift(...batch); // Put back to retry
  }
}, 10000);

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`  ☯ 风水大师 (FengShuiMaster) 本地服务端已启动！`);
  console.log(`  PC 端访问: http://localhost:${PORT}`);
  console.log(`  手机端访问: 请连接热点，访问 http://192.168.137.1:${PORT}`);
  console.log(`======================================================\n`);
});
