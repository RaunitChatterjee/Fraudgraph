import { TACTIC_TONE } from '../lib.jsx'

const TACTICS = ['Preparation', 'Placement', 'Layering', 'Extraction']

export default function Matrix({ typologies, onPick }) {
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold">FG-Matrix: financial-crime typologies</h1>
        <p className="max-w-3xl text-sm text-muted">
          Original classification of money-laundering modus operandi in UPI / net-banking fraud, organised by tactic in the spirit of MITRE ATT&amp;CK.
          Each technique lists the graph and behavioural signal the detector uses. Select one to see the flagged accounts.
        </p>
      </div>
      <div className="grid gap-3 lg:grid-cols-4">
        {TACTICS.map((tac) => (
          <div key={tac} className="space-y-2">
            <div className="text-sm font-semibold">{tac}</div>
            {typologies.filter((t) => t.tactic === tac).map((t) => (
              <button key={t.code} onClick={() => onPick(t.code)}
                className={`w-full rounded-md border border-line border-l-4 ${TACTIC_TONE[tac]} bg-panel p-3 text-left hover:bg-raised`}>
                <div className="flex items-baseline justify-between"><span className="font-mono text-xs text-muted">{t.tid}</span>
                  <span className="text-xs tabnum">{t.flagged_accounts} flagged</span></div>
                <div className="mt-0.5 font-medium">{t.name}</div>
                <p className="mt-1 text-xs text-muted">{t.description}</p>
                <p className="mt-2 text-xs"><span className="text-muted">Signal: </span>{t.signal}</p>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
