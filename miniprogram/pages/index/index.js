const api = require('../../utils/api.js');
const format = require('../../utils/format.js');

const EXAMPLE = '一个人吃，30元以内，不吃辣，要汉堡和无糖饮料，在附近门店自取。';

Page({
  data: {
    text: '',
    fulfillment: 'pickup',
    location: '',
    budget: '',
    people: '',
    budgets: [15, 20, 30, 50, 80],
    quotes: [],
    catalogText: '',
    loading: false,
    messages: [],
    quote: null,
    mode: '',
    online: null,
    integration: null,
    mcpChecked: false,
    example: EXAMPLE
  },

  onLoad() {
    const app = getApp();
    this.setData({
      fulfillment: app.globalData.fulfillment || 'pickup',
      location: app.globalData.location || '',
      budget: app.globalData.budget || '',
      people: app.globalData.people || ''
    });
  },

  onShow() {
    const app = getApp();
    this.setData({ mode: app.globalData.mode || '', online: app.globalData.online });
    if (app.globalData.quote) this.setData({ quote: format.toQuoteView(app.globalData.quote) });
    api.health().then(info => {
      app.globalData.mode = info.mode;
      app.globalData.online = true;
      this.setData({ mode: info.mode, online: true, integration: info.integration || null, mcpChecked: !!(info.integration && info.integration.upstreamChecked), catalogText: info.catalog
        ? '已载入广州产品参考库：' + info.catalog.productCount + '款产品 / ' + info.catalog.variantCount + '条规格' : '' });
    }).catch(() => this.setData({ online: false }));
  },

  onText(event) {
    this.setData({ text: event.detail.value });
  },

  onLocation(event) {
    this.setData({ location: event.detail.value });
  },

  onBudget(event) {
    this.setData({ budget: event.detail.value });
  },
  onPeople(event) { this.setData({ people: event.detail.value }); },
  pickBudget(event) { this.setData({ budget: String(event.currentTarget.dataset.value) }); },
  selectQuote(event) {
    const quote = (getApp().globalData.quotes || [])[Number(event.currentTarget.dataset.index)];
    if (!quote) return;
    getApp().globalData.quote = quote;
    this.setData({ quote: format.toQuoteView(quote) });
    this.goQuote();
  },

  switchFulfillment(event) {
    this.setData({ fulfillment: event.currentTarget.dataset.value });
  },

  fillExample() {
    this.setData({ text: EXAMPLE });
  },

  goSettings() {
    wx.switchTab({ url: '/pages/settings/settings' });
  },

  goQuote() {
    wx.navigateTo({ url: '/pages/quote/quote' });
  },

  buildHistory(app, userText, answer) {
    const history = app.globalData.history.slice(-18);
    history.push({ role: 'user', content: userText });
    if (answer) history.push({ role: 'assistant', content: answer });
    app.globalData.history = history;
  },

  async generate() {
    const app = getApp();
    const text = this.data.text.trim();
    if (!text) {
      wx.showToast({ title: '先说说想吃什么', icon: 'none' });
      return;
    }
    if (!this.data.location.trim()) {
      wx.showToast({ title: '请填写城市或附近地标', icon: 'none' });
      return;
    }
    if (this.data.loading) return;

    const draft = {
      fulfillment: this.data.fulfillment,
      location: this.data.location.trim(),
      budget: this.data.budget
    };
    app.rememberDraft(draft);
    app.globalData.people = this.data.people;
    app.globalData.quote = null;
    app.globalData.quotes = [];

    const messages = this.data.messages.concat([{ role: 'user', text: text }]);
    this.setData({ loading: true, messages: messages, quote: null, quotes: [] });
    wx.showLoading({ title: '正在查菜单配餐…', mask: true });

    try {
      const result = await api.plan({
        text: text,
        history: app.globalData.history.slice(-18),
        context: {
          fulfillment: draft.fulfillment,
          location: draft.location,
          budget: draft.budget === '' ? null : Number(draft.budget),
          ...(this.data.people === '' ? {} : { people: Number(this.data.people) })
        }
      });
      const answer = result.message || '没有拿到回复。';
      this.buildHistory(app, text, answer);
      const next = { loading: false, messages: this.data.messages.concat([{ role: 'assistant', text: answer }]) };
      const quotes = result.quotes || (result.quote ? [result.quote] : []);
      app.globalData.quotes = quotes;
      next.quotes = quotes.map(format.toQuoteView);
      this.setData(next);
      if (quotes.length) wx.pageScrollTo({ selector: '#recommendations', duration: 250 });
    } catch (error) {
      const answer = error.message || '这次没成功。';
      this.buildHistory(app, text, answer);
      this.setData({
        loading: false,
        messages: this.data.messages.concat([{ role: 'assistant', text: answer, error: true }])
      });
      if (error.statusCode === 401) {
        wx.showModal({
          title: '口令不对',
          content: '后端拒绝了这次请求。请到「连接设置」检查访问口令是否和 .env 里的 APP_ACCESS_KEY 一致。',
          confirmText: '去设置',
          success: (res) => { if (res.confirm) this.goSettings(); }
        });
      }
    } finally {
      wx.hideLoading();
    }
  }
});
