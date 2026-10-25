// 电脑调试页：只用同源请求，口令存在本机 localStorage。
(function () {
  const el = (id) => document.getElementById(id);
  const state = { quote: null, quotes: [], catalogOffset: 0, key: localStorage.getItem('accessKey') || 'demo-local-only' };

  el('key').value = state.key;

  function headers() {
    return { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (el('key').value || '') };
  }

  async function call(path, options) {
    const opts = options || {};
    const response = await fetch(path, {
      method: opts.method || 'GET',
      headers: headers(),
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || ('HTTP ' + response.status));
      error.status = response.status;
      error.extra = data;
      throw error;
    }
    return data;
  }

  function showAnswer(text, bad) {
    const node = el('answer');
    node.hidden = false;
    node.textContent = text;
    node.className = bad ? 'answer bad' : 'answer';
  }

  function money(value) { return Number(value).toFixed(2); }

  function renderOptions(data) {
    state.quotes = data.quotes || (data.quote ? [data.quote] : []);
    el('optionsPanel').hidden = !state.quotes.length;
    el('optionsNotice').textContent = data.menuCoverage ? data.menuCoverage.stores.map(s => s.name + '：已检索 ' + s.menuItems + ' 个官方菜单项目').join('；') + '，核价成功 ' + data.menuCoverage.quotedCandidates + ' 个候选。用时 ' + (data.performance.elapsedMs / 1000).toFixed(1) + ' 秒。' : data.notice || (data.priceBasis === 'official' ? '每份方案均已单独经过官方计价。' : '模拟预算价，不是广州门店售价。');
    el('options').innerHTML = state.quotes.map((quote, i) => {
      const kcal = quote.nutrition && quote.nutrition.kcal;
      return '<article class="proposal"><h3>' + escapeHtml(quote.title || '配餐方案') + ' <span class="total">¥' + money(quote.total) + '</span></h3>' +
        '<p class="muted">' + (quote.people || 1) + '人 · ' + (quote.demo ? '模拟价' : '官方核价') + ' · ' + escapeHtml(quote.fulfillment) + '</p>' +
        '<ul class="lines">' + quote.lines.map(line => '<li><span>' + escapeHtml(line.name) + ' × ' + line.quantity + '</span><span>¥' + money(line.subtotal) + '</span></li>').join('') + '</ul>' +
        (quote.note ? '<p class="muted">' + escapeHtml(quote.note) + '</p>' : '') +
        (kcal ? '<p class="muted">' + (kcal.complete ? '参考热量 ' + kcal.total : '已知部分热量 ' + kcal.knownTotal + '（资料不全）') + ' 千卡</p>' : '') +
        '<button class="ghost" data-option="' + i + '">选择这份搭配</button></article>';
    }).join('');
    if (state.quotes.length) el('optionsPanel').scrollIntoView({ behavior: 'smooth' });
  }

  function renderQuote(quote) {
    state.quote = quote;
    const panel = el('quotePanel');
    panel.hidden = false;
    const lines = (quote.lines || []).map((line) =>
      '<li><span>' + escapeHtml(line.name) + ' × ' + line.quantity + '</span><span>¥' + money(line.subtotal) + '</span></li>'
    ).join('');
    const takeWays = (quote.takeWays || []).map((item) =>
      '<label class="opt"><input type="radio" name="takeWay" value="' + escapeHtml(String(item.code)) + '" /> ' + escapeHtml(item.name) + '</label>'
    ).join('');
    el('quoteBody').innerHTML =
      '<p class="tag">' + (quote.demo ? '演示方案 · 不会真实下单' : '真实方案') + '</p>' +
      '<h3>' + escapeHtml(quote.title || '配餐方案') + '</h3>' +
      '<p><strong>' + escapeHtml(quote.fulfillment) + '</strong> · ' +
      escapeHtml((quote.store && quote.store.name) || '') + '<br /><span class="muted">' +
      escapeHtml((quote.store && quote.store.address) || '') + '</span></p>' +
      (quote.destination ? '<p class="muted">收货地址：' + escapeHtml(quote.destination) + '</p>' : '') +
      '<ul class="lines">' + lines + '</ul>' +
      '<p class="total">应付 ¥' + money(quote.total) + '</p>' +
      (takeWays ? '<fieldset><legend>取餐方式</legend>' + takeWays + '</fieldset>' : '') +
      (quote.note ? '<p class="muted">' + escapeHtml(quote.note) + '</p>' : '');
    panel.scrollIntoView({ behavior: 'smooth' });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const STATUS = { submitting: '正在提交', created: '已创建订单', unknown: '待核实' };

  function renderOrders(list) {
    if (!list.length) { el('orders').innerHTML = '<p class="muted">还没有订单记录。</p>'; return; }
    el('orders').innerHTML = list.map((item) => {
      const order = item.order || {};
      const warn = item.status === 'unknown' || item.status === 'submitting';
      return '<div class="order">' +
        '<p><span class="tag ' + (warn ? 'tag-danger' : '') + '">' + escapeHtml(STATUS[item.status] || item.status) + '</span>' +
        (item.demo ? ' <span class="muted">演示记录</span>' : '') + '</p>' +
        (order.orderId ? '<p>订单号：' + escapeHtml(order.orderId) + '</p>' : '') +
        (order.storeName ? '<p>门店：' + escapeHtml(order.storeName) + '</p>' : '') +
        (order.total ? '<p>金额：¥' + escapeHtml(order.total) + '</p>' : '') +
        (order.orderStatus ? '<p>状态：' + escapeHtml(order.orderStatus) + '</p>' : '') +
        (order.pickupCode ? '<p>取餐码：' + escapeHtml(order.pickupCode) + '</p>' : '') +
        (item.message ? '<p class="muted">' + escapeHtml(item.message) + '</p>' : '') +
        (order.payUrl ? '<p><a href="' + escapeHtml(order.payUrl) + '" target="_blank" rel="noopener">打开官方支付链接</a></p>' : '') +
        '</div>';
    }).join('');
  }

  async function loadOrders() {
    try {
      const data = await call('/api/orders');
      renderOrders(data.orders || []);
    } catch (error) {
      el('orders').innerHTML = '<p class="bad">' + escapeHtml(error.message) + '</p>';
    }
  }

  el('save').addEventListener('click', () => {
    localStorage.setItem('accessKey', el('key').value);
    showAnswer('口令已保存在本机浏览器里。', false);
  });

  el('check').addEventListener('click', async () => {
    try {
      const data = await call('/api/check', { method: 'POST', body: {} });
      showAnswer(data.message, false);
    } catch (error) { showAnswer(error.message, true); }
  });

  el('plan').addEventListener('click', async () => {
    const budget = el('budget').value;
    state.quote = null;
    state.quotes = [];
    el('quotePanel').hidden = true;
    el('optionsPanel').hidden = true;
    el('plan').disabled = true;
    showAnswer('正在检索门店完整菜单，按偏好筛选候选并核算实际组成…', false);
    try {
      const data = await call('/api/plan', {
        method: 'POST',
        body: {
          text: el('text').value,
          context: {
            fulfillment: el('fulfillment').value,
            location: el('location').value,
            budget: budget === '' ? null : Number(budget),
            ...(el('people').value === '' ? {} : { people: Number(el('people').value) })
          }
        }
      });
      showAnswer(data.message || '没有回复。', false);
      renderOptions(data);
      el('plan').textContent = state.quotes.length ? '换一批搭配' : '帮我配餐';
    } catch (error) {
      showAnswer(error.message, true);
      el('quotePanel').hidden = true;
    } finally { el('plan').disabled = false; }
  });

  el('options').addEventListener('click', event => {
    const button = event.target.closest('button[data-option]');
    if (button && state.quotes[Number(button.dataset.option)]) renderQuote(state.quotes[Number(button.dataset.option)]);
  });
  document.querySelectorAll('[data-budget]').forEach(button => button.addEventListener('click', () => { el('budget').value = button.dataset.budget; }));

  async function loadCatalog(offset = 0) {
    try {
      const params = new URLSearchParams({ q: el('catalogQuery').value, category: el('catalogCategory').value, offset: String(offset), limit: '12' });
      const data = await call('/api/catalog?' + params);
      state.catalogOffset = offset;
      if (el('catalogCategory').options.length === 1) for (const category of data.categories) {
        const option = document.createElement('option'); option.value = category; option.textContent = category; el('catalogCategory').appendChild(option);
      }
      el('catalogInfo').textContent = data.metadata.productCount + '款产品 / ' + data.metadata.variantCount + '条规格，采集于' + data.metadata.collectedOn + '。门店供应和价格未核验。当前匹配' + data.total + '款。';
      el('catalogResults').innerHTML = data.products.map(p => '<article class="catalog-product"><strong>' + escapeHtml(p.name) + '</strong> <span class="muted">' + escapeHtml(p.category) + '</span><p class="muted">' +
        p.variants.map(v => escapeHtml(v.serving_label) + '：' + (v.energy_kcal === null ? '热量资料缺失' : v.energy_kcal + ' 千卡（参考）')).join('；') + '</p></article>').join('') || '<p class="muted">没有匹配产品。</p>';
      el('catalogPrev').hidden = !offset;
      el('catalogNext').hidden = offset + data.products.length >= data.total;
    } catch (error) { el('catalogInfo').textContent = error.message; }
  }
  el('searchCatalog').addEventListener('click', () => loadCatalog(0));
  el('catalogPrev').addEventListener('click', () => loadCatalog(Math.max(0, state.catalogOffset - 12)));
  el('catalogNext').addEventListener('click', () => loadCatalog(state.catalogOffset + 12));

  el('confirm').addEventListener('click', async () => {
    if (!state.quote) return;
    const picked = document.querySelector('input[name="takeWay"]:checked');
    try {
      const data = await call('/api/confirm', {
        method: 'POST',
        body: { quoteId: state.quote.id, takeWayCode: picked ? picked.value : '', confirmed: true }
      });
      showAnswer((STATUS[data.status] || data.status) + (data.message ? ' · ' + data.message : ''), data.status === 'unknown');
      await loadOrders();
    } catch (error) {
      showAnswer(error.message, true);
      if (error.status === 409 && error.extra && error.extra.quote) renderQuote(error.extra.quote);
    }
  });

  el('reload').addEventListener('click', loadOrders);

  (async function start() {
    try {
      const info = await call('/api/health');
      el('health').textContent = info.mode === 'demo'
        ? '后端已连接 · 演示模式（不会真实下单）'
        : '后端已连接 · 真实模式（会调用官方接口）';
      el('health').className = 'health ok';
      await loadOrders();
      await loadCatalog();

    } catch (error) {
      el('health').textContent = '连不上后端：' + error.message;
      el('health').className = 'health bad';
    }
  })();
})();
