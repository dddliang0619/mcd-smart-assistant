const api = require('../../utils/api.js');
const format = require('../../utils/format.js');

Page({
  data: {
    view: null,
    takeWayCode: '',
    submitting: false,
    attempt: null,
    order: null,
    message: '',
    changed: false,
    refreshing: false
  },

  onLoad() {
    const app = getApp();
    const quote = app.globalData.quote;
    if (!quote) {
      this.setData({ message: '没有待确认的方案，请先回首页描述需求。' });
      return;
    }
    this.applyQuote(quote);
  },

  // 后端返回的报价在 5 分钟内有效，过期要重新生成。
  applyQuote(quote) {
    const view = format.toQuoteView(quote);
    this.setData({
      view: view,
      takeWayCode: view.takeWays.length ? String(view.takeWays[0].code) : '',
      attempt: null,
      order: null,
      changed: false,
      message: ''
    });
  },

  pickTakeWay(event) {
    this.setData({ takeWayCode: String(event.currentTarget.dataset.code) });
  },

  copyPayUrl() {
    const url = this.data.order && this.data.order.payUrl;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '支付链接已复制', icon: 'none' })
    });
  },

  async submit() {
    if (this.data.submitting || !this.data.view) return;
    if (this.data.view.takeWays.length && !this.data.takeWayCode) {
      wx.showToast({ title: '请选一下取餐方式', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    wx.showLoading({ title: '正在核对并下单…', mask: true });
    try {
      // 只提交报价编号和已展示的取餐方式，金额和餐品以服务端保存的方案为准。
      const attempt = await api.confirm({
        quoteId: this.data.view.id,
        takeWayCode: this.data.takeWayCode,
        confirmed: true
      });
      this.setData({
        submitting: false,
        attempt: attempt,
        order: attempt.order || null,
        message: attempt.message || ''
      });
    } catch (error) {
      const extra = error.extra || {};
      const next = { submitting: false, message: error.message || '下单没有完成。' };
      // 门店调价或餐品变化时，后端会带回一份新方案，必须让用户重新确认。
      if (error.statusCode === 409 && extra.quote) {
        const app = getApp();
        app.globalData.quote = extra.quote;
        this.applyQuote(extra.quote);
        next.message = error.message;
        next.changed = true;
      }
      this.setData(next);
    } finally {
      wx.hideLoading();
    }
  },

  async refresh() {
    if (!this.data.attempt || this.data.refreshing) return;
    this.setData({ refreshing: true });
    wx.showLoading({ title: '正在查询官方订单…', mask: true });
    try {
      const attempt = await api.refresh(this.data.attempt.quoteId);
      this.setData({
        refreshing: false,
        attempt: attempt,
        order: attempt.order || null,
        message: attempt.message || ''
      });
    } catch (error) {
      this.setData({ refreshing: false, message: error.message || '查询失败。' });
    } finally {
      wx.hideLoading();
    }
  },

  backHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});