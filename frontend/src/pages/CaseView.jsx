import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import Graph, { LEGEND } from '../Graph.jsx'
import { ErrorBox, Panel, PriorityBadge, ScoreBar, Spinner, STATUS_LABEL, STATUSES, TypoTag, fmtTime, inr } from '../lib.jsx'

export default function CaseView({ caseId, onBack, onChanged }) {
  const [c, setC] = useState(null)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)
  const [extra, setExtra] = useState({ nodes: [], edges: [] })
  const [tab, setTab] = useState('account')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api.case(caseId).then(setC).catch(setErr), [caseId])
  useEffect(() => { setC(null); setExtra({ nodes: [], edges: [] }); setSel(null); load() }, [load])

  const baseNodes = useMemo(() => (c ? c.analysis.nodes.map((n) => ({ ...n, label: n.holder_name })) : []), [c])
  const baseEdges = useMemo(() => (c ? c.analysis.edges.map((e) => ({ source: e.src, target: e.dst, amount: e.amount, loop: e.loop })) : []), [c])
  const nodes = useMemo(() => [...baseNodes, ...extra.nodes], [baseNodes, extra])
  const edges = useMemo(() => [...baseEdges, ...extra.edges], [baseEdges, extra])
  const selected = nodes.find((n) => n.id === sel)

  const expand = async (id) => {
    if (id.startsWith('CASH:')) return
    try {
      const nb = await api.neighborhood(id, 1)
      const have = new Set(nodes.map((n) => n.id))
      const haveE = new Set(edges.map((e) => `${e.source}>${e.target}`))
      setExtra((x) => ({
        nodes: [...x.nodes, ...nb.nodes.filter((n) => !have.has(n.id)).map((n) => ({ ...n, role: 'neighbor' }))],
        edges: [...x.edges, ...nb.edges.filter((e) => !haveE.has(`${e.src}>${e.dst}`)).map((e) => ({ source: e.src, target: e.dst, amount: e.total }))],
      }))
    } catch (e) { setErr(e) }
  }

  const act = async (fn) => {
    setBusy(true); setErr(null)
    try { setC(await fn()); onChanged?.() } catch (e) { setErr(e) } finally { setBusy(false) }
  }

  if (!c) return <div><button onClick={onBack} className="text-accent text-sm">← Queue</button><ErrorBox error={err} />{!err && <Spinner />}</div>
  const st = c.analysis.stats
  const cp = c.complaint
  const mules = c.analysis.nodes.filter((n) => n.role === 'mule').sort((a, b) => a.hop - b.hop || b.score - a.score)
  const btn = 'rounded border border-line bg-raised px-2.5 py-1.5 text-sm hover:border-accent disabled:opacity-50'

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="text-sm text-accent hover:underline">← Queue</button>
        <h1 className="text-lg font-semibold">{c.id}</h1>
        <PriorityBadge label={c.priority_label} score={c.priority_score} />
        <select value={c.status} disabled={busy} onChange={(e) => act(() => api.updateCase(c.id, { status: e.target.value }))}
          className="rounded border border-line bg-panel px-2 py-1 text-sm" aria-label="Case status">
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <a href={api.reportUrl(c.id)} className={`${btn} ml-auto`} download>Export PDF report</a>
      </div>
      <ErrorBox error={err} />

      <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Reported', inr(cp.amount)], ['Accounts traced', `${st.accounts_traced} (${st.max_hop_depth} hops)`],
          ['Cash-out detected', inr(st.cash_out_total)], ['Still in accounts', inr(st.recoverable_amount)],
          ['Frozen so far', inr(c.frozen_amount)], ['Money moved in', `${Math.round(st.money_span_minutes)} min`],
        ].map(([l, v]) => (
          <div key={l} className="rounded-md border border-line bg-panel px-3 py-2"><div className="text-xs text-muted">{l}</div><div className="font-semibold tabnum">{v}</div></div>
        ))}
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Money trail" right={<span className="text-xs text-muted">click: details · double-click: expand · drag: pin</span>}>
          <div className="relative">
            <Graph nodes={nodes} edges={edges} selectedId={sel} onSelect={(id) => { setSel(id); setTab('account') }} onExpand={expand} />
            <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded bg-panel/80 px-2 py-1 text-[11px]">
              {LEGEND.map(([col, l]) => <span key={l} className="flex items-center gap-1"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: col }} />{l}</span>)}
            </div>
          </div>
        </Panel>

        <Panel
          right={
            <div className="flex rounded border border-line text-xs overflow-hidden" role="tablist">
              {[['account', 'Account'], ['accounts', `Accounts (${mules.length})`], ['timeline', 'Notes & timeline']].map(([k, l]) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                  className={`px-2.5 py-1 ${tab === k ? 'bg-accent text-white' : 'bg-panel text-muted hover:text-ink'}`}>{l}</button>
              ))}
            </div>
          }>
          <div className="max-h-[610px] overflow-y-auto p-3 text-sm">
            {tab === 'account' && (!selected ? (
              <div className="space-y-2 text-muted">
                <p>Select an account on the graph to see why it was flagged.</p>
                <p><b className="text-ink">Complaint:</b> {cp.description}</p>
                <p>Filed {fmtTime(cp.filed_at)}. Origin transaction <span className="font-mono text-xs">{cp.origin_txn_id}</span>.</p>
                <p className="text-xs">Priority: {Object.entries(c.analysis.priority.components).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · ')}</p>
                {c.linked_accounts.length > 0 && (
                  <div className="mt-3 border-t border-line pt-2">
                    <b className="text-ink">Linked accounts off the money trail</b>
                    {c.linked_accounts.slice(0, 8).map((a) => (
                      <button key={a.id} onClick={() => expand(a.id).then(() => setSel(a.id))} className="mt-1 flex w-full justify-between rounded px-1 py-0.5 text-left text-xs hover:bg-raised">
                        <span className="font-mono">{a.id}</span><span>{a.via.split(' with')[0]} · {a.score.toFixed(2)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="font-mono text-xs">{selected.id}</div>
                <div className="text-base font-semibold">{selected.holder_name || selected.label}</div>
                <div className="text-xs text-muted">{selected.bank} {selected.account_type && `· ${selected.account_type}`} {selected.status === 'frozen' && '· FROZEN'}</div>
                {selected.score != null && <ScoreBar value={selected.score} />}
                <div className="flex flex-wrap gap-1">{(selected.typologies || selected.labels || []).map((t) => <TypoTag key={t} code={t} />)}</div>
                {selected.role === 'mule' && (
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted">Hop</dt><dd>{selected.hop}</dd>
                    <dt className="text-muted">Received</dt><dd className="tabnum">{inr(selected.inflow)}</dd>
                    <dt className="text-muted">Forwarded</dt><dd className="tabnum">{inr(selected.outflow)}</dd>
                    <dt className="text-muted">Cash withdrawn</dt><dd className="tabnum">{inr(selected.withdrawn)}</dd>
                    <dt className="text-muted">Still held</dt><dd className="tabnum">{inr(selected.retained)}</dd>
                  </dl>
                )}
                {selected.evidence?.length > 0 && (
                  <div><div className="mb-1 text-xs font-semibold">Why flagged</div>
                    <ul className="list-disc space-y-1 pl-4 text-xs text-muted">{selected.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
                )}
                <div className="flex flex-wrap gap-2 pt-1">
                  {!selected.id.startsWith('CASH:') && <button className={btn} onClick={() => expand(selected.id)}>Expand neighbourhood</button>}
                  {selected.role === 'mule' && selected.status !== 'frozen' && (
                    <button className={`${btn} border-crit/60 text-crit`} disabled={busy}
                      onClick={() => window.confirm(`Simulate freezing ${selected.id}? Est. ${inr(selected.retained)} held.`) && act(() => api.freeze(c.id, selected.id))}>
                      Freeze account (simulated)
                    </button>
                  )}
                </div>
              </div>
            ))}

            {tab === 'accounts' && (
              <table className="w-full text-xs">
                <thead className="text-left text-muted"><tr><th className="py-1">Account</th><th>Hop</th><th>Score</th><th className="text-right">Held</th></tr></thead>
                <tbody>{mules.map((n) => (
                  <tr key={n.id} onClick={() => { setSel(n.id); setTab('account') }} className="cursor-pointer border-t border-line/60 hover:bg-raised">
                    <td className="py-1 font-mono">{n.id.slice(-8)}{n.status === 'frozen' && ' ❄'}</td><td>{n.hop}</td>
                    <td><ScoreBar value={n.score} /></td><td className="text-right tabnum">{inr(n.retained)}</td>
                  </tr>))}</tbody>
              </table>
            )}

            {tab === 'timeline' && (
              <div className="space-y-3">
                <form onSubmit={(e) => { e.preventDefault(); if (note.trim()) act(() => api.addNote(c.id, note)).then(() => setNote('')) }} className="space-y-2">
                  <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Investigator note…"
                    className="w-full rounded border border-line bg-bg p-2 text-sm" aria-label="Investigator note" />
                  <button className={btn} disabled={busy || !note.trim()}>Add note</button>
                </form>
                <ol className="space-y-2">
                  {[...c.events].reverse().map((e) => (
                    <li key={e.id} className="border-l-2 border-line pl-2 text-xs">
                      <div className="text-muted">{fmtTime(e.ts)} · {e.actor}</div>
                      <div>{e.kind === 'note' ? e.payload.text : e.kind === 'freeze' ? `Froze ${e.payload.account_id} (est. ${inr(e.payload.amount_frozen)} held)`
                        : e.kind === 'status' ? `Status: ${STATUS_LABEL[e.payload.from]} → ${STATUS_LABEL[e.payload.to]}` : 'Case created; money trace and prioritisation run'}</div>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  )
}
