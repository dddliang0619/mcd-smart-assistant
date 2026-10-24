const config = require('../config.js');

// 后端地址和口令优先读「连接设置」里存的，没存过就用 config.js 的默认值。
function readSettings() {
  const saved = wx.getStorageSync('connection') || {};
  // Migrate the original localhost demo defaults when a real-device profile is provided.
  // Preserve any manually configured server or key.
  const oldDemo = /^http:\/\/(127\.0\.0\.1|localhost):8787\/?$/.test(saved.baseUrl || '') && saved.accessKey === 'demo-local-only';
  if (oldDemo && config.baseUrl !== 'http://127.0.0.1:8787' && config.accessKey !== 'demo-local-only') {
    return { baseUrl: String(config.baseUrl).replace(/\/+$/, ''), accessKey: String(config.accessKey) };
  }
  return {
    baseUrl: String(saved.baseUrl || config.baseUrl || '').replace(/\/+$/, ''),
    accessKey: String(saved.accessKey || config.accessKey || '')
  };
}

function saveSettings(next) {
  wx.setStorageSync('connection', {
    baseUrl: String(next.baseUrl || '').replace(/\/+$/, ''),
    accessKey: String(next.accessKey || '')
  });
}

function request(path, options) {
  const opts = options || {};
  const { baseUrl, accessKey } = readSettings();
  if (!baseUrl) {
    return Promise.reject(new Error('还没有填写后端地址，请先到「连接设置」里填。'));
  }
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl + path,
      method: opts.method || 'GET',
      data: opts.data,
      timeout: config.requestTimeout,
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + accessKey
      },
      success(res) {
        const body = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body);
          return;
        }
        const message = body.error || ('请求失败（HTTP ' + res.statusCode + '）');
        const error = new Error(message);
        error.statusCode = res.statusCode;
        error.extra = body;
        reject(error);
      },
      fail(err) {
        reject(new Error('连接后端失败：' + ((err && err.errMsg) || '未知错误') +
          '。请确认后端已启动、地址填对，并在开发者工具里勾选「不校验合法域名」。'));
      }
    });
  });
}

module.exports = {
  readSettings,
  saveSettings,
  health: () => request('/api/health'),
  // 真实模式下会去官方账号核对点餐接口是否齐全。
  check: () => request('/api/check', { method: 'POST', data: {} }),
  plan: (payload) => request('/api/plan', { method: 'POST', data: payload }),
  integration: () => request('/api/integration'),
  confirm: (payload) => request('/api/confirm', { method: 'POST', data: payload }),
  orders: () => request('/api/orders'),
  refresh: (quoteId) => request('/api/orders/' + quoteId, { method: 'POST', data: {} })
};
