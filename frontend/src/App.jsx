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
  ['overview', 'Overview'],
  ['queue', 'Investigations'],
  ['matrix', 'Typology matrix'],
  ['metrics', 'Evaluation'],
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
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-lg border-2 border-ink/80 bg-panel p-6">
        <h2 className="font-display text-xl font-medium">Register a complaint</h2>
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
  const [dark, setDark] = useState(false)
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
      <div className="flex min-h-full flex-col">
        <header className="border-b-[3px] border-double border-ink/30 bg-panel/80">
          <div className="mx-auto flex max-w-[1520px] flex-wrap items-center gap-x-6 gap-y-3 px-4 pb-0 pt-3 md:px-6">
            <button onClick={() => go('overview')} className="flex items-center gap-3 text-left" aria-label="FraudGraph home">
              <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden="true">
                <rect width="32" height="32" rx="3" fill="rgb(var(--ink))" />
                <path d="M7 23L14 12l5 7 6-11" stroke="rgb(var(--panel))" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="25" cy="8" r="3" fill="#c8372d" />
              </svg>
              <span>
                <span className="font-display block text-[22px] font-medium leading-none">FraudGraph</span>
                <span className="mt-1 block text-[11.5px] italic text-muted">Register of mule-account investigations</span>
              </span>
            </button>

            <form className="relative ml-auto w-full max-w-sm sm:w-72" onSubmit={(e) => { e.preventDefault(); if (search.trim()) { setDrawer(search.trim()); setSearch('') } }}>
              <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Look up account, e.g. ACC12345678"
                aria-label="Look up account" className="mono w-full rounded-sm border border-line bg-bg/70 py-1.5 pl-8 pr-2 text-[12.5px] placeholder:font-sans placeholder:text-muted" />
            </form>
            <div className="flex items-center gap-2.5">
              {asOf && <span className="hidden items-center gap-1.5 text-xs text-muted lg:flex" title="Dataset reference time"><Icon name="clock" size={13} />As of {fmtTime(asOf)}</span>}
              <button onClick={() => setDark(!dark)} className="rounded-sm border border-line p-1.5 text-muted hover:text-ink" aria-label="Switch between ledger paper and night desk themes">
                <Icon name={dark ? 'sun' : 'moon'} size={15} /></button>
              <button onClick={() => setIntake(true)} className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-3 py-1.5 text-[13px] font-medium text-white">
                <Icon name="plus" size={14} />Register complaint</button>
            </div>

            <nav className="-mb-px flex w-full gap-1 overflow-x-auto" aria-label="Sections">
              {NAV.map(([k, l]) => (
                <button key={k} onClick={() => go(k)} aria-current={activeNav === k ? 'page' : undefined}
                  className={`whitespace-nowrap border-x border-t px-4 py-2 text-[13px] ${activeNav === k
                    ? 'relative border-ink/30 bg-bg font-medium text-ink' : 'border-transparent text-muted hover:text-ink'}`}
                  style={activeNav === k ? { borderTopWidth: 3, borderTopColor: '#c8372d', marginBottom: -1 } : undefined}>{l}</button>
              ))}
            </nav>
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto max-w-[1520px] p-4 md:p-6">
            <ErrorBox error={err} />
            {page === 'overview' && <Overview onOpenCase={openCase} refreshKey={tick} />}
            {page === 'queue' && <Queue onOpenCase={openCase} onOpenAccount={setDrawer} presetTypology={preset} refreshKey={tick} />}
            {page === 'case' && <CaseView caseId={caseId} onBack={() => go('queue')} onChanged={() => setTick((x) => x + 1)} onOpenAccount={setDrawer} />}
            {page === 'matrix' && <Matrix typologies={typologies} onPick={(c) => { setPreset(c); setPage('queue') }} />}
            {page === 'metrics' && <Metrics />}
          </div>
          <footer className="mx-auto max-w-[1520px] px-6 pb-6 text-[11.5px] italic text-muted">
            All data in this register is synthetic. No real accounts, people or banking systems are involved.
          </footer>
        </main>

        {drawer && <AccountDrawer accountId={drawer} onClose={() => setDrawer(null)} onOpenCase={openCase} />}
        {intake && <IntakeModal onClose={() => setIntake(false)} onCreated={(id) => { setIntake(false); setTick((x) => x + 1); openCase(id) }} />}
      </div>
    </TypoContext.Provider>
  )
}
