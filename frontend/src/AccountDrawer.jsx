import { useEffect, useState } from 'react'
import { api } from './api.js'
import { ErrorBox, Icon, Spinner, TypoTag, fmtTime, inr, useTypo, PRIORITY_HEX } from './lib.jsx'

function Ring({ value }) {
  const R = 30, C = 2 * Math.PI * R
  const col = value >= 0.8 ? '#f2545b' : value >= 0.5 ? '#f08a3c' : '#7f8db0'
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" role="img" aria-label={`Composite suspicion ${value.toFixed(2)}`}>
      <circle cx="38" cy="38" r={R} fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="7" />
      <circle cx="38" cy="38" r={R} fill="none" stroke={col} strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${C * value} ${C}`} transform="rotate(-90 38 38)" />
      <text x="38" y="38" textAnchor="middle" dy="0.34em" fontSize="18" fontWeight="600" fill="currentColor" className="num">{value.toFixed(2)}</text>
    </svg>
  )
}

export default function AccountDrawer({ accountId, onClose, onOpenCase }) {
  const typo = useTypo()
  const [d, setD] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setD(null); setErr(null)
    api.account(accountId).then(setD).catch(setErr)
  }, [accountId])
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const f = d?.features
  const typs = d ? Object.entries(d.score.typologies).sort((a, b) => b[1].score - a[1].score) : []
  return (
    <div className="fixed inset-0 z-30" role="dialog" aria-modal="true" aria-label="Account analysis">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside className="slidein absolute right-0 top-0 h-full w-full max-w-[470px] overflow-y-auto border-l border-line bg-panel shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-4 py-3">
          <div className="text-sm font-semibold">Account analysis</div>
          <button onClick={onClose} className="rounded p-1 text-muted hover:bg-raised hover:text-ink" aria-label="Close"><Icon name="close" /></button>
        </div>
        <ErrorBox error={err} />
        {!d && !err && <Spinner />}
        {d && (
          <div className="space-y-5 p-4">
            <div className="flex items-center gap-4">
              <Ring value={d.score.composite} />
              <div className="min-w-0">
                <div className="mono text-xs text-muted">{d.account.id}</div>
                <div className="truncate text-lg font-semibold">{d.account.holder_name}</div>
                <div className="text-xs text-muted">{d.account.bank} · {d.account.account_type}
                  {d.account.status === 'frozen' && <span className="ml-2 rounded bg-frozen/20 px-1.5 py-0.5 text-frozen">frozen</span>}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">{d.score.labels.map((t) => <TypoTag key={t} code={t} />)}</div>
              </div>
            </div>

            {d.cases.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted">Appears in</span>
                {d.cases.map((c) => (
                  <button key={c} onClick={() => { onClose(); onOpenCase(c) }} className="mono rounded border border-line px-2 py-0.5 text-accent hover:border-accent">{c}</button>
                ))}
              </div>
            )}

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Typology scores and evidence</h3>
              <ul className="space-y-3">
                {typs.map(([code, t]) => {
                  const meta = typo[code]
                  const live = t.score >= 0.2
                  return (
                    <li key={code}>
                      <div className="flex items-center justify-between text-[13px]">
                        <span>{meta ? `${meta.tid} ${meta.name}` : code}</span><span className="num text-muted">{t.score.toFixed(2)}</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-raised">
                        <div className="h-full rounded" style={{ width: `${t.score * 100}%`, background: t.score >= 0.45 ? PRIORITY_HEX.High : '#7f8db0' }} />
                      </div>
                      {live && (
                        <ul className="mt-1.5 space-y-1 border-l border-line pl-3 text-xs text-muted">
                          {t.evidence.filter((e) => e.weight !== 'gate' || e.value < 1).slice(0, 4).map((e, i) => (
                            <li key={i}>{e.text}{e.contribution != null && <span className="num ml-1 text-ink/70">(+{e.contribution.toFixed(2)})</span>}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
              {d.score.legitimacy > 0.2 && (
                <p className="mt-2 text-xs text-muted">Legitimacy dampener {d.score.legitimacy.toFixed(2)}: sustained activity or recurring counterparties lower the score.</p>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Behaviour</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {[['Received', inr(f.inflow)], ['Sent on', inr(f.outflow)], ['Cash withdrawn', inr(f.wd_total)],
                  ['Largest inbound', inr(f.peak_in)], ['Forwarded within 6h', `${Math.round(f.pass_ratio * 100)}%`],
                  ['Median dwell', `${Math.round(f.median_dwell_min)} min`], ['Active days', f.active_days],
                  ['In / out degree', `${f.in_degree} / ${f.out_degree}`]].map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-line/50 py-1"><dt className="text-muted">{k}</dt><dd className="num">{v}</dd></div>
                ))}
              </dl>
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Top counterparties</h3>
              <ul className="space-y-1 text-xs">
                {d.top_counterparties.slice(0, 6).map((c) => (
                  <li key={c.account_id} className="flex justify-between"><span className="mono">{c.account_id}</span>
                    <span className="num text-muted">in {inr(c.in)} · out {inr(c.out)}</span></li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Recent transactions</h3>
              <table className="w-full text-xs">
                <tbody>
                  {d.recent_transactions.slice(0, 10).map((t) => {
                    const out = t.src === d.account.id
                    return (
                      <tr key={t.id} className="border-t border-line/60">
                        <td className="py-1 text-muted">{fmtTime(t.ts)}</td>
                        <td>{t.kind === 'withdrawal' ? 'cash out' : out ? `to ${t.dst.slice(-6)}` : `from ${t.src.slice(-6)}`}</td>
                        <td className={`num text-right ${out ? '' : 'text-ok'}`}>{out ? '−' : '+'}{inr(t.amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </section>
          </div>
        )}
      </aside>
    </div>
  )
}
