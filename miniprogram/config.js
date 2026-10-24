// 后端地址与访问口令。
// 想改默认值，就在同目录复制一份 config.local.js（已被 .gitignore 忽略），例如：
// module.exports = { baseUrl: 'http://192.168.1.20:8787', accessKey: '你的口令' };
let local = {};
try {
  local = require('./config.local.js');
} catch (error) {
  // 没有 config.local.js 时使用下面的默认值。
}

module.exports = {
  // 电脑上的后端默认地址。手机实测要换成电脑的局域网地址，并让后端 HOST=0.0.0.0。
  baseUrl: local.baseUrl || 'http://127.0.0.1:8787',
  // 与后端 .env 里的 APP_ACCESS_KEY 一致；演示模式默认是 demo-local-only。
  accessKey: local.accessKey || 'demo-local-only',
  // 配餐会多次调用官方接口和 AI，超时给宽一点。
  requestTimeout: 200000
};