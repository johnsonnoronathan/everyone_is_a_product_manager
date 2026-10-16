// Helpers shared by load.js and oversell.js.
import http from 'k6/http';

// Replaces {{user}} and {{n}} placeholders in strings, objects and arrays.
export function fill(value, vars) {
  if (typeof value === 'string') return value.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? ''));
  if (Array.isArray(value)) return value.map((v) => fill(v, vars));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = fill(v, vars);
    return out;
  }
  return value;
}

// Builds [method, url, body, params] for http.request / http.batch.
export function buildRequest(baseUrl, step, { vars = {}, token = null, auth = null, timeoutSeconds = 10, tags = {}, responseType } = {}) {
  const headers = { ...fill(step.headers ?? {}, vars) };
  let body = null;
  if (step.body !== null && step.body !== undefined) {
    body = typeof step.body === 'string' ? fill(step.body, vars) : JSON.stringify(fill(step.body, vars));
    if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  }
  if (token && auth) headers[auth.header ?? 'Authorization'] = `${auth.prefix ?? 'Bearer '}${token}`;
  const ok = [{ min: 200, max: 399 }, ...(step.okStatuses ?? [])];
  return [
    step.method.toUpperCase(),
    baseUrl + fill(step.path, vars),
    body,
    { headers, timeout: `${timeoutSeconds}s`, tags, responseCallback: http.expectedStatuses(...ok), ...(responseType ? { responseType } : {}) },
  ];
}

// Signs in `count` test users in batches and returns their tokens.
export function loginPool(baseUrl, auth, count, prefix = 'lt') {
  const tokens = [];
  const field = auth.tokenField ?? 'token';
  for (let start = 0; start < count; start += 50) {
    const batch = [];
    for (let i = start; i < Math.min(count, start + 50); i++) {
      batch.push(buildRequest(baseUrl, auth, { vars: { user: `${prefix}${i}`, n: i }, tags: { endpoint: 'login_setup' }, responseType: 'text' }));
    }
    for (const res of http.batch(batch)) {
      let token = null;
      try {
        token = res.json(field);
      } catch (_) {
        // handled below
      }
      if (res.status >= 400 || !token) throw new Error(`Test-user sign-in failed: HTTP ${res.status} ${String(res.body).slice(0, 200)}`);
      tokens.push(token);
    }
  }
  return tokens;
}

export function runSetupStep(baseUrl, step, timeoutSeconds = 30) {
  if (!step) return;
  const [method, url, body, params] = buildRequest(baseUrl, step, { timeoutSeconds, tags: { endpoint: 'setup' }, responseType: 'text' });
  const res = http.request(method, url, body, params);
  if (res.status >= 400) throw new Error(`Setup request ${method} ${url} failed: HTTP ${res.status} ${String(res.body).slice(0, 200)}`);
}

export function fmtMs(ms) {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '—';
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`;
}

export function pct(rate) {
  if (rate === undefined || rate === null || Number.isNaN(rate)) return '—';
  return `${(rate * 100).toFixed(rate < 0.01 && rate > 0 ? 2 : 1)}%`;
}
