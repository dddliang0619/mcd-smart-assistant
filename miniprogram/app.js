const api = require('./utils/api.js');

App({
  globalData: {
    // 方案对象在页面之间传递，放这里比塞进 URL 安全。
    quote: null,
    // 最近一次对话，用于让 AI 接着上下文补充条件。
    history: [],
    fulfillment: 'pickup',
    location: '',
    budget: ''
  },

  onLaunch() {
    const saved = wx.getStorageSync('draft');
    if (saved) {
      this.globalData.fulfillment = saved.fulfillment || 'pickup';
      this.globalData.location = saved.location || '';
      this.globalData.budget = saved.budget || '';
    }
    // 启动时探一次后端，连不上就在首页提示去设置里改地址。
    api.health()
      .then((info) => { this.globalData.mode = info.mode; this.globalData.online = true; })
      .catch(() => { this.globalData.online = false; });
  },

  // 记下用户填过的位置和预算，下次打开不用重填。
  rememberDraft(draft) {
    this.globalData.fulfillment = draft.fulfillment;
    this.globalData.location = draft.location;
    this.globalData.budget = draft.budget;
    wx.setStorageSync('draft', draft);
  }
});