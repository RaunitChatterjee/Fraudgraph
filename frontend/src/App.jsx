import { useEffect, useState } from 'react'
import { api } from './api.js'
import { ErrorBox, TypoContext } from './lib.jsx'
import Queue from './pages/Queue.jsx'
import CaseView from './pages/CaseView.jsx'
import Matrix from './pages/Matrix.jsx'
import Metrics from './pages/Metrics.jsx'

const NAV = [['queue', 'Investigation queue'], ['matrix', 'Typology matrix'], ['metrics', 'Evaluation']]

function IntakeModal({ onClose, onCreated }) {
  const [f, setF] = useState({ victim_account: '', amount: '', origin_txn_id: '', category: '' })
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null)
    try {
      const body = { victim_account: f.victim_account.trim(), category: f.category || undefined,
        origin_txn_id: f.origin_txn_id.trim() || undefined, amount: f.amount ? Number(f.amount) : undefined }
      onCreated((await api.intake(body)).case_id)
    } catch (x) { setErr(x) } finally { setBusy(false) }
  }
  const inp = 'w-full rounded border border-line bg-bg px-2 py-1.5 text-sm'
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Register complaint">
      <form onSubmit={submit} className="w-full max-w-md space-y-3 rounded-md border border-line bg-panel p-4">
        <h2 className="text-base font-semibold">Register complaint</h2>
        <p className="text-xs text-muted">Give the victim account plus either the transaction id from the victim's statement or the amount; the origin transaction is located and the money trail is traced.</p>
        <label className="block text-xs">Victim account<input required className={inp} value={f.victim_account} onChange={set('victim_account')} placeholder="ACC12345678" /></label>
        <label className="block text-xs">Origin transaction id<input className={inp} value={f.origin_txn_id} onChange={set('origin_txn_id')} placeholder="TXN000012345" /></label>
        <label className="block text-xs">…or amount (INR)<input className={inp} type="number" min="1" value={f.amount} onChange={set('amount')} /></label>
        <label className="block text-xs">Category<input className={inp} value={f.category} onChange={set('category')} placeholder="e.g. OTP phishing" /></label>
        <ErrorBox error={err} />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-line px-3 py-1.5 text-sm">Cancel</button>
          <button disabled={busy} className="rounded bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-60">Register &amp; trace</button>
        </div>
      </form>
    </div>
  )
}

export default function App() {
  const [dark, setDark] = useState(true)
  const [page, setPage] = useState('queue')
  const [caseId, setCaseId] = useState(null)
  const [typologies, setTypologies] = useState([])
  const [preset, setPreset] = useState('')
  const [intake, setIntake] = useState(false)
  const [tick, setTick] = useState(0)
  const [err, setErr] = useState(null)

  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])
  useEffect(() => { api.typologies().then(setTypologies).catch(setErr) }, [tick])
  const typoMap = Object.fromEntries(typologies.map((t) => [t.code, t]))

  const open = (id) => { setCaseId(id); setPage('case') }
  const go = (p) => { setPage(p); setCaseId(null); setPreset('') }

  return (
    <TypoContext.Provider value={typoMap}>
      <div className="flex h-full">
        <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-panel md:flex">
          <div className="px-4 py-4">
            <div className="text-base font-semibold tracking-tight">FraudGraph</div>
            <div className="text-xs text-muted">Mule network investigation</div>
          </div>
          <nav className="flex-1 space-y-0.5 px-2">
            {NAV.map(([k, l]) => (
              <button key={k} onClick={() => go(k)} aria-current={page === k || (page === 'case' && k === 'queue') ? 'page' : undefined}
                className={`w-full rounded px-3 py-2 text-left text-sm ${(page === k || (page === 'case' && k === 'queue')) ? 'bg-accent/15 text-ink font-medium' : 'text-muted hover:bg-raised hover:text-ink'}`}>{l}</button>
            ))}
          </nav>
          <div className="space-y-2 border-t border-line p-3">
            <button onClick={() => setIntake(true)} className="w-full rounded bg-accent px-3 py-2 text-sm text-white">Register complaint</button>
            <button onClick={() => setDark(!dark)} className="w-full rounded border border-line px-3 py-1.5 text-xs text-muted hover:text-ink">{dark ? 'Light mode' : 'Dark mode'}</button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between border-b border-line bg-panel px-3 py-2 md:hidden">
            <b>FraudGraph</b>
            <div className="flex gap-2">
              {NAV.map(([k, l]) => <button key={k} onClick={() => go(k)} className="text-xs text-muted">{l.split(' ')[0]}</button>)}
              <button onClick={() => setIntake(true)} className="text-xs text-accent">+ Complaint</button>
            </div>
          </div>
          <div className="mx-auto max-w-[1500px] p-3 md:p-5">
            <ErrorBox error={err} />
            {page === 'queue' && <Queue onOpenCase={open} presetTypology={preset} refreshKey={tick} />}
            {page === 'case' && <CaseView caseId={caseId} onBack={() => go('queue')} onChanged={() => setTick((x) => x + 1)} />}
            {page === 'matrix' && <Matrix typologies={typologies} onPick={(c) => { setPreset(c); setPage('queue') }} />}
            {page === 'metrics' && <Metrics />}
          </div>
        </main>
        {intake && <IntakeModal onClose={() => setIntake(false)} onCreated={(id) => { setIntake(false); setTick((x) => x + 1); open(id) }} />}
      </div>
    </TypoContext.Provider>
  )
}
