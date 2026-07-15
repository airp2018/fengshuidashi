const http = require('https');

// Feishu Credentials
const APP_ID = 'cli_aaafbe4e9cf89cd9';
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const APP_TOKEN = 'L4RMwYvS2iuAAxkymUgcGeNrnub'; // Wiki Base Token
const TABLE_ID = 'tblzshBXvOljvhHM';

// Local cache for tenant token to avoid fetching on every API call
let cachedToken = null;
let tokenExpiresAt = 0;

function requestFeishu(options, bodyData) {
  return new Promise((resolve, reject) => {
    const postData = bodyData ? JSON.stringify(bodyData) : '';
    const req = http.request({
      hostname: 'open.feishu.cn',
      port: 443,
      path: options.path,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        ...options.headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(new Error(`解析 JSON 失败: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function getTenantToken() {
  if (!APP_SECRET) {
    throw new Error('Missing FEISHU_APP_SECRET environment variable');
  }

  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt) {
    return cachedToken;
  }

  const res = await requestFeishu({
    path: '/open-apis/auth/v3/tenant_access_token/internal',
    method: 'POST'
  }, {
    app_id: APP_ID,
    app_secret: APP_SECRET
  });

  if (res.tenant_access_token) {
    cachedToken = res.tenant_access_token;
    // Token is valid for 2 hours, expire local cache 5 minutes early
    tokenExpiresAt = now + (res.expire - 300) * 1000;
    return cachedToken;
  } else {
    throw new Error(`获取飞书 Token 失败: ${JSON.stringify(res)}`);
  }
}

// Find record by client_uuid (uses Search API)
async function findRecordByUuid(token, clientUuid) {
  const res = await requestFeishu({
    path: `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/search`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  }, {
    filter: {
      conjunction: 'and',
      conditions: [
        {
          field_name: '设备 ID',
          operator: 'is',
          value: [clientUuid]
        }
      ]
    }
  });

  if (res.code === 0 && res.data && res.data.items && res.data.items.length > 0) {
    return res.data.items[0]; // Return the first matched record
  }
  return null;
}

// Submit a pending payment claim
async function addOrUpdatePendingClaim(clientUuid, tier, paymentInfo, cooperationInterest) {
  const token = await getTenantToken();
  const existingRecord = await findRecordByUuid(token, clientUuid);
  
  const amountStr = parseInt(tier, 10) === 50 ? '5 元' : (parseInt(tier, 10) === 100 ? '10 元' : '未知');
  const fields = {
    '打赏额度': parseInt(tier, 10),
    '打赏金额': amountStr,
    '打赏昵称/单号': paymentInfo,
    '合作留言': cooperationInterest || '',
    '审核状态': '待审核',
    '提交时间': new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  };

  const headers = { 'Authorization': `Bearer ${token}` };

  if (existingRecord) {
    // Update existing row
    console.log(`[Feishu] Updating existing record ${existingRecord.record_id} for client: ${clientUuid}`);
    const res = await requestFeishu({
      path: `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${existingRecord.record_id}`,
      method: 'PUT',
      headers: headers
    }, {
      fields: fields
    });
    if (res.code !== 0) {
      throw new Error(`更新飞书记录失败: ${res.msg}`);
    }
    return { success: true, record_id: existingRecord.record_id };
  } else {
    // Insert new row
    fields['设备 ID'] = clientUuid;
    console.log(`[Feishu] Creating new record for client: ${clientUuid}`);
    const res = await requestFeishu({
      path: `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records`,
      method: 'POST',
      headers: headers
    }, {
      fields: fields
    });
    if (res.code !== 0) {
      throw new Error(`新增飞书记录失败: ${res.msg}`);
    }
    return { success: true, record_id: res.data.record.record_id };
  }
}

// Check check-unlock status
async function checkUnlockStatus(clientUuid) {
  const token = await getTenantToken();
  const record = await findRecordByUuid(token, clientUuid);

  if (!record) {
    return { found: false, status: 'none' };
  }

  const fields = record.fields;
  const status = fields['审核状态'] || '待审核';
  const tier = fields['打赏额度'] || 6;

  return {
    found: true,
    status: status,
    tier: parseInt(tier, 10),
    payment_info: fields['打赏昵称/单号'] || ''
  };
}

let logsTableId = null;

// Ensure the logs table exists in Bitable, creating it automatically if missing
async function getOrCreateLogsTable(token) {
  if (logsTableId) return logsTableId;

  const headers = { 'Authorization': `Bearer ${token}` };

  // 1. List existing tables
  const listRes = await requestFeishu({
    path: `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`,
    method: 'GET',
    headers: headers
  });

  if (listRes.code === 0 && listRes.data && listRes.data.items) {
    const existing = listRes.data.items.find(t => t.name === '访问与活跃日志');
    if (existing) {
      logsTableId = existing.table_id;
      console.log(`[Feishu] Found existing logs table: ${logsTableId}`);
      return logsTableId;
    }
  }

  // 2. Not found, create it!
  console.log(`[Feishu] Logs table '访问与活跃日志' not found, creating it...`);
  const createRes = await requestFeishu({
    path: `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables`,
    method: 'POST',
    headers: headers
  }, {
    table: {
      name: '访问与活跃日志',
      fields: [
        { "field_name": "设备 ID", "type": 1 },
        { "field_name": "IP 地址", "type": 1 },
        { "field_name": "时间", "type": 1 },
        { "field_name": "事件类型", "type": 1 },
        { "field_name": "测算场景", "type": 1 },
        { "field_name": "设备环境 (UserAgent)", "type": 1 },
        { "field_name": "设备尺寸", "type": 1 }
      ]
    }
  });

  if (createRes.code === 0 && createRes.data && createRes.data.table_id) {
    logsTableId = createRes.data.table_id;
    console.log(`[Feishu] Created logs table successfully: ${logsTableId}`);
    return logsTableId;
  } else {
    throw new Error(`创建飞书日志表失败: ${JSON.stringify(createRes)}`);
  }
}

// Batch insert access logs to Bitable
async function batchInsertLogs(records) {
  const token = await getTenantToken();
  const tableId = await getOrCreateLogsTable(token);
  
  const headers = { 'Authorization': `Bearer ${token}` };
  const res = await requestFeishu({
    path: `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${tableId}/records/batch_create`,
    method: 'POST',
    headers: headers
  }, {
    records: records
  });

  if (res.code !== 0) {
    throw new Error(`批量写入飞书日志失败: ${res.msg}`);
  }
  return { success: true };
}

async function updateClaimStatusInFeishu(clientUuid, status) {
  const token = await getTenantToken();
  const existingRecord = await findRecordByUuid(token, clientUuid);
  if (!existingRecord) {
    throw new Error(`未找到该设备的飞书记录: ${clientUuid}`);
  }

  const headers = { 'Authorization': `Bearer ${token}` };
  const res = await requestFeishu({
    path: `/open-apis/bitable/v1/apps/${APP_TOKEN}/tables/${TABLE_ID}/records/${existingRecord.record_id}`,
    method: 'PUT',
    headers: headers
  }, {
    fields: {
      '审核状态': status
    }
  });

  if (res.code !== 0) {
    throw new Error(`同步状态至飞书失败: ${res.msg}`);
  }
  return { success: true };
}

module.exports = {
  addOrUpdatePendingClaim,
  checkUnlockStatus,
  batchInsertLogs,
  updateClaimStatusInFeishu
};
