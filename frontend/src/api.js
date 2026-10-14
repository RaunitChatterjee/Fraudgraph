const BASE = import.meta.env.VITE_API_URL || ''

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  })
  if (!res.ok) {
    let msg = res.statusText
    try { const j = await res.json(); msg = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail) } catch { /* ignore */ }
    throw new Error(msg)
  }
  return res.json()
}

const qs = (o) => {
  const p = new URLSearchParams()
  Object.entries(o).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v) })
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const api = {
  stats: () => req('/api/stats'),
  typologies: () => req('/api/typologies'),
  alerts: (f = {}) => req('/api/alerts' + qs(f)),
  cases: (f = {}) => req('/api/cases' + qs(f)),
  case: (id) => req(`/api/cases/${id}`),
  updateCase: (id, body) => req(`/api/cases/${id}`, { method: 'PATCH', body }),
  addNote: (id, text) => req(`/api/cases/${id}/notes`, { method: 'POST', body: { text } }),
  freeze: (id, account_id) => req(`/api/cases/${id}/freeze`, { method: 'POST', body: { account_id } }),
  neighborhood: (acct, depth = 1) => req(`/api/accounts/${acct}/neighborhood?depth=${depth}`),
  account: (acct) => req(`/api/accounts/${acct}`),
  intake: (body) => req('/api/complaints', { method: 'POST', body }),
  metrics: () => req('/api/metrics'),
  reportUrl: (id) => `${BASE}/api/cases/${id}/report.pdf`,
}
