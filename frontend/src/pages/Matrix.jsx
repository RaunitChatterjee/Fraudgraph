import { TACTIC_HEX } from '../lib.jsx'

const TACTICS = ['Preparation', 'Placement', 'Layering', 'Extraction']
const BLURB = {
  Preparation: 'Setting up the accounts', Placement: 'Stolen funds enter the mule network',
  Layering: 'Distance the money from its source', Extraction: 'Turning balances into cash',
}

export default function Matrix({ typologies, onPick }) {
  const max = Math.max(1, ...typologies.map((t) => t.flagged_accounts))
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-[28px] font-medium leading-tight">FG-Matrix: financial-crime typologies</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          An original classification of money-laundering modus operandi in UPI and net-banking fraud, organised by tactic in the way MITRE ATT&amp;CK
          organises adversary techniques. Each technique names the signal the detector scores. Select one to list the accounts flagged for it.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        {TACTICS.map((tac) => (
          <section key={tac} className="space-y-3">
            <header className="rounded-lg border border-line bg-panel px-3 py-2.5" style={{ borderTop: `3px solid ${TACTIC_HEX[tac]}` }}>
              <div className="text-sm font-semibold">{tac}</div><div className="text-xs text-muted">{BLURB[tac]}</div>
            </header>
            {typologies.filter((t) => t.tactic === tac).map((t) => {
              const heat = t.flagged_accounts / max
              return (
                <button key={t.code} onClick={() => onPick(t.code)}
                  className="relative w-full overflow-hidden rounded-lg border border-line bg-panel p-3 text-left hover:border-accent">
                  <span className="absolute inset-y-0 left-0 w-1" style={{ background: TACTIC_HEX[tac], opacity: 0.25 + 0.75 * heat }} />
                  <div className="flex items-baseline justify-between pl-1.5">
                    <span className="mono text-xs text-muted">{t.tid}</span>
                    <span className="num text-xs"><b className="text-[15px]">{t.flagged_accounts}</b> <span className="text-muted">flagged</span></span>
                  </div>
                  <div className="mt-0.5 pl-1.5 font-medium">{t.name}</div>
                  <p className="mt-1 pl-1.5 text-xs text-muted">{t.description}</p>
                  <p className="mt-2 pl-1.5 text-xs"><span className="text-muted">Detected by </span>{t.signal}</p>
                </button>
              )
            })}
          </section>
        ))}
      </div>
    </div>
  )
}
