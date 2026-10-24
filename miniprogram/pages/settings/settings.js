const api = require('../../utils/api.js');

Page({
  data: {
    baseUrl: '',
    accessKey: '',
    mode: '',
    message: '',
    checking: false,
    saving: false,
    integration: null
  },

  onLoad() {
    const settings = api.readSettings();
    this.setData({ baseUrl: settings.baseUrl, accessKey: settings.accessKey });
    this.probe();
  },

  onBase(event) {
    this.setData({ baseUrl: event.detail.value });
  },

  onKey(event) {
    this.setData({ accessKey: event.detail.value });
  },

  async probe() {
    try {
      const info = await api.health();
      getApp().globalData.mode = info.mode;
      getApp().globalData.online = true;
      this.setData({ mode: info.mode, message: info.message || '', integration: info.integration || null });
    } catch (error) {
      getApp().globalData.online = false;
      this.setData({ mode: '', message: error.message || '连不上后端。' });
    }
  },

  save() {
    const baseUrl = this.data.baseUrl.trim();
    if (!/^https?:\/\//.test(baseUrl)) {
      wx.showToast({ title: '地址要以 http:// 或 https:// 开头', icon: 'none' });
      return;
    }
    api.saveSettings({ baseUrl: baseUrl, accessKey: this.data.accessKey.trim() });
    this.setData({ saving: true });
    wx.showToast({ title: '已保存', icon: 'none' });
    this.probe().then(() => this.setData({ saving: false }));
  },

  async check() {
    if (this.data.checking) return;
    this.setData({ checking: true, message: '' });
    try {
      const result = await api.check();
      this.setData({ checking: false, message: result.message || '检查通过。', integration: result.integration || null });
    } catch (error) {
      this.setData({ checking: false, message: error.message || '检查没有通过。', integration: error.extra && error.extra.integration || null });
    }
  }
});
