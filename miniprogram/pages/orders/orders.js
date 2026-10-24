const api = require('../../utils/api.js');
const format = require('../../utils/format.js');

Page({
  data: {
    list: [],
    loading: false,
    loaded: false,
    message: ''
  },

  onShow() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().then(() => wx.stopPullDownRefresh());
  },

  async load() {
    if (this.data.loading) return;
    this.setData({ loading: true, message: '' });
    try {
      const result = await api.orders();
      this.setData({ list: this.decorate(result.orders || []), loading: false, loaded: true });
    } catch (error) {
      this.setData({ loading: false, loaded: true, message: error.message || '读取订单失败。' });
    }
  },

  decorate(list) {
    return list.map((item) => ({
      quoteId: item.quoteId,
      status: item.status,
      statusText: format.statusText(item.status),
      warn: item.status === 'unknown' || item.status === 'submitting',
      demo: item.demo,
      timeText: format.formatTime(item.createdAt),
      message: item.message || '',
      orderId: item.order ? item.order.orderId : '',
      orderStatus: item.order ? item.order.orderStatus : '',
      storeName: item.order ? item.order.storeName : '',
      total: item.order ? item.order.total : '',
      pickupCode: item.order ? item.order.pickupCode : '',
      payUrl: item.order ? item.order.payUrl : ''
    }));
  },

  async refreshItem(event) {
    const quoteId = event.currentTarget.dataset.id;
    wx.showLoading({ title: '查询官方订单…', mask: true });
    try {
      await api.refresh(quoteId);
      await this.load();
      wx.showToast({ title: '已更新', icon: 'none' });
    } catch (error) {
      wx.showToast({ title: error.message || '查询失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  copyPayUrl(event) {
    const url = event.currentTarget.dataset.url;
    if (!url) return;
    wx.setClipboardData({
      data: url,
      success: () => wx.showToast({ title: '支付链接已复制', icon: 'none' })
    });
  },

  goHome() {
    wx.switchTab({ url: '/pages/index/index' });
  }
});