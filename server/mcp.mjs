import { randomUUID } from 'node:crypto';

export class UpstreamError extends Error {}

// Streamable HTTP may respond with JSON or SSE, including an open event stream.
export async function readRpc(response, id) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError(`麦当劳服务返回 HTTP ${response.status}，请检查 Token 或稍后重试。`);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done }).replace(/\r\n/g, '\n');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || data === '[DONE]') continue;
        let payload;
        try { payload = JSON.parse(data); } catch { continue; }
        if (payload.id === id) return payload;
      }
      if (done) throw new UpstreamError('麦当劳响应未包含完整结果，请稍后查询订单，勿重复下单。');
      if (buffer.length > 4_000_000) throw new UpstreamError('麦当劳响应过大。');
    }
  } finally { await reader.cancel().catch(() => {}); }
}

export function unpackTool(result) {
  let payload = result.structuredContent;
  if (!payload) {
    const contents = (result.content || []).filter(item => item.type === 'text').map(item => item.text);
    for (const value of contents) {
      try { payload = JSON.parse(value); break; } catch { /* Non-JSON text is kept below. */ }
    }
    if (!payload) payload = { text: contents.join('\n') };
  }
  if (result.isError || payload.success === false || (payload.code !== undefined && ![0, 200, '0', '200'].includes(payload.code))) {
    throw new UpstreamError('麦当劳未接受本次请求，请检查餐品、门店或登录状态。');
  }
  return payload.data ?? payload;
}

export class McdClient {
  constructor({ token, fetchImpl = fetch, url = 'https://mcp.mcd.cn' }) {
    this.token = token; this.fetch = fetchImpl; this.url = url;
    this.version = '2025-06-18'; this.session = null; this.tools = null;
  }
  async rpc(method, params = {}, notification = false) {
    const id = randomUUID();
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${this.token}` };
    if (this.initialized) headers['MCP-Protocol-Version'] = this.version;
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    // No automatic retries: create-order can succeed even if the connection fails.
    const response = await this.fetch(this.url, {
      method: 'POST', headers, signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id }), method, params })
    });
    this.session = response.headers.get('mcp-session-id') || this.session;
    if (notification) {
      await response.body?.cancel();
      if (!response.ok) throw new UpstreamError(`麦当劳会话初始化失败：HTTP ${response.status}`);
      return;
    }
    const body = await readRpc(response, id);
    if (body.id !== id || body.error) throw new UpstreamError('麦当劳接口调用失败；请检查官方接口权限和参数。');
    return body.result;
  }
  async ready() {
    if (this.tools) return this.tools;
    if (!this.loading) this.loading = this.initialize().finally(() => { this.loading = null; });
    return this.loading;
  }
  async initialize() {
    const hello = await this.rpc('initialize', {
      protocolVersion: this.version, capabilities: {}, clientInfo: { name: 'personal-order-assistant', version: '0.1.0' }
    });
    this.version = hello.protocolVersion || this.version;
    this.initialized = true;
    await this.rpc('notifications/initialized', {}, true);
    const tools = [];
    let cursor;
    do {
      const result = await this.rpc('tools/list', cursor ? { cursor } : {});
      tools.push(...result.tools); cursor = result.nextCursor;
      if (tools.length > 500) throw new UpstreamError('工具列表异常。');
    } while (cursor);
    this.tools = tools;
    return tools;
  }
  async call(name, args) {
    await this.ready();
    return unpackTool(await this.rpc('tools/call', { name, arguments: args }));
  }
}
