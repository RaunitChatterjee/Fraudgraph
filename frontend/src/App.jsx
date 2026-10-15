import { useEffect, useState } from 'react'
import { api } from './api.js'
import AccountDrawer from './AccountDrawer.jsx'
import { ErrorBox, Icon, TypoContext, fmtTime } from './lib.jsx'
import CaseView from './pages/CaseView.jsx'
import Matrix from './pages/Matrix.jsx'
import Metrics from './pages/Metrics.jsx'
import Overview from './pages/Overview.jsx'
import Queue from './pages/Queue.jsx'

const NAV = [
  ['overview', 'Overview', 'overview'],
  ['queue', 'Investigations', 'queue'],
  ['matrix', 'Typology matrix', 'matrix'],
  ['metrics', 'Evaluation', 'eval'],
]

function IntakeModal({ onClose, onCreated }) {
  const [f, setF] = useState({ victim_account: '', amount: '', origin_txn_id: '', category: '' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const body = {
        victim_account: f.victim_account.trim(), category: f.category || undefined,
        origin_txn_id: f.origin_txn_id.trim() || undefined, amount: f.amount ? Number(f.amount) : undefined,
      }
      onCreated((await api.intake(body)).case_id)
    } catch (x) { setErr(x) } finally { setBusy(false) }
  }
  const inp = 'mt-1 w-full rounded-md border border-line bg-bg px-2.5 py-1.5 text-sm'
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Register complaint">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-lg border border-line bg-panel p-5">
        <h2 className="text-base font-semibold">Register complaint</h2>
        <p className="text-xs text-muted">Enter the victim account and either the transaction id from the victim's statement or the amount. The origin transfer is located and the money trail traced.</p>
        <label className="block text-xs text-muted">Victim account<input required className={inp} value={f.victim_account} onChange={set('victim_account')} placeholder="ACC12345678" /></label>
        <label className="block text-xs text-muted">Origin transaction id<input className={inp} value={f.origin_txn_id} onChange={set('origin_txn_id')} placeholder="TXN000012345" /></label>
        <label className="block text-xs text-muted">…or amount (INR)<input className={inp} type="number" min="1" value={f.amount} onChange={set('amount')} /></label>
        <label className="block text-xs text-muted">Category<input className={inp} value={f.category} onChange={set('category')} placeholder="e.g. OTP phishing" /></label>
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border border-line px-3 py-1.5 text-sm">Cancel</button>
          <button disabled={busy} className="rounded-md bg-accent px-3.5 py-1.5 text-sm font-medium text-white disabled:opacity-60">Register and trace</button>
        </div>
      </form>
    </div>
  )
}

export default function App() {
  const [dark, setDark] = useState(true)
  const [page, setPage] = useState('overview')
  const [caseId, setCaseId] = useState(null)
  const [typologies, setTypologies] = useState([])
  const [preset, setPreset] = useState('')
  const [intake, setIntake] = useState(false)
  const [drawer, setDrawer] = useState(null)
  const [tick, setTick] = useState(0)
  const [asOf, setAsOf] = useState(null)
  const [search, setSearch] = useState('')
  const [err, setErr] = useState(null)

  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])
  useEffect(() => { api.typologies().then(setTypologies).catch(setErr) }, [tick])
  useEffect(() => { api.stats().then((s) => setAsOf(s.as_of)).catch(() => {}) }, [tick])
  const typoMap = Object.fromEntries(typologies.map((t) => [t.code, t]))

  const openCase = (id) => { setCaseId(id); setPage('case') }
  const go = (p) => { setPage(p); setCaseId(null); setPreset('') }
  const activeNav = page === 'case' ? 'queue' : page

  return (
    <TypoContext.Provider value={typoMap}>
      <div className="flex h-full">
        <aside className="hidden w-[212px] shrink-0 flex-col border-r border-line bg-panel md:flex">
          <div className="flex items-center gap-2.5 px-4 py-4">
            <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
              <rect width="32" height="32" rx="7" fill="rgb(var(--raised))" />
              <path d="M7 22L14 11l5 7 6-10" stroke="#f5a524" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="7" cy="22" r="2.4" fill="#4c9aff" /><circle cx="25" cy="8" r="2.4" fill="#f5a524" />
            </svg>
            <div><div className="text-[15px] font-semibold leading-tight">FraudGraph</div><div className="text-[11px] text-muted">Mule network investigation</div></div>
          </div>
          <nav className="flex-1 space-y-0.5 px-2 pt-1">
            {NAV.map(([k, l, icon]) => (
              <button key={k} onClick={() => go(k)} aria-current={activeNav === k ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] ${activeNav === k ? 'bg-accent/15 font-medium text-ink' : 'text-muted hover:bg-raised hover:text-ink'}`}>
                <Icon name={icon} size={16} className={activeNav === k ? 'text-accent' : ''} />{l}
              </button>
            ))}
          </nav>
          <div className="space-y-2 border-t border-line p-3">
            <button onClick={() => setIntake(true)} className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[13px] font-medium text-white">
              <Icon name="plus" size={15} />Register complaint</button>
            <p className="px-1 text-[11px] leading-snug text-muted">Synthetic data. No real accounts or banking systems.</p>
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2.5">
            <form className="relative max-w-md flex-1" onSubmit={(e) => { e.preventDefault(); if (search.trim()) { setDrawer(search.trim()); setSearch('') } }}>
              <Icon name="search" size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Look up an account id, e.g. ACC12345678"
                aria-label="Look up account" className="mono w-full rounded-md border border-line bg-bg py-1.5 pl-8 pr-2 text-[13px] placeholder:font-sans" />
            </form>
            <div className="ml-auto flex items-center gap-3">
              {asOf && <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-muted sm:flex" title="Dataset reference time">
                <Icon name="clock" size={13} />Data as of {fmtTime(asOf)}</span>}
              <button onClick={() => setDark(!dark)} className="rounded-md border border-line p-1.5 text-muted hover:text-ink" aria-label="Toggle light or dark theme">
                <Icon name={dark ? 'sun' : 'moon'} size={16} /></button>
              <button onClick={() => setIntake(true)} className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white md:hidden">+ Complaint</button>
            </div>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b border-line bg-panel px-2 py-1.5 md:hidden">
            {NAV.map(([k, l]) => <button key={k} onClick={() => go(k)} className={`whitespace-nowrap rounded px-2.5 py-1 text-xs ${activeNav === k ? 'bg-accent/15 text-ink' : 'text-muted'}`}>{l}</button>)}
          </nav>
          <div className="flex-1 overflow-y-auto">
            <div className="mx-auto max-w-[1520px] p-4 md:p-6">
              <ErrorBox error={err} />
              {page === 'overview' && <Overview onOpenCase={openCase} refreshKey={tick} />}
              {page === 'queue' && <Queue onOpenCase={openCase} onOpenAccount={setDrawer} presetTypology={preset} refreshKey={tick} />}
              {page === 'case' && <CaseView caseId={caseId} onBack={() => go('queue')} onChanged={() => setTick((x) => x + 1)} onOpenAccount={setDrawer} />}
              {page === 'matrix' && <Matrix typologies={typologies} onPick={(c) => { setPreset(c); setPage('queue') }} />}
              {page === 'metrics' && <Metrics />}
            </div>
          </div>
        </main>

        {drawer && <AccountDrawer accountId={drawer} onClose={() => setDrawer(null)} onOpenCase={openCase} />}
        {intake && <IntakeModal onClose={() => setIntake(false)} onCreated={(id) => { setIntake(false); setTick((x) => x + 1); openCase(id) }} />}
      </div>
    </TypoContext.Provider>
  )
}
