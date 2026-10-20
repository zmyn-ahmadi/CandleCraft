import { useMemo, useState } from 'react'
import { AlertCircle, Check, Upload } from 'lucide-react'
import { guessColumns, importFields, importTrade, parseCsv, type ColumnMap, type ImportField } from './csv'
import type { Account, Environment, Trade } from './model'

export default function ImportModal({ accounts, accountId, environment, existing, onClose, onImport }: { accounts: Account[]; accountId: string; environment: Environment; existing: Trade[]; onClose: () => void; onImport: (trades: Trade[]) => void }) {
  const [name, setName] = useState('')
  const [raw, setRaw] = useState('')
  const [delimiter, setDelimiter] = useState(',')
  const [selectedAccount, setSelectedAccount] = useState(accountId)
  const [selectedEnvironment, setSelectedEnvironment] = useState<Environment>(environment)
  const [profitIsNet, setProfitIsNet] = useState(false)
  const [mapping, setMapping] = useState<ColumnMap | null>(null)
  const [fileError, setFileError] = useState('')
  const table = useMemo(() => { try { return parseCsv(raw, delimiter) } catch { return [] } }, [raw, delimiter])
  const headers = table[0] || []
  const columns = mapping || guessColumns(headers)
  const preview = useMemo(() => { const seen = new Set<string>(); return table.slice(1).map((row, index) => {
    try {
      const trade = importTrade(row, columns, selectedAccount, selectedEnvironment, profitIsNet)
      const fingerprint = trade.externalRef ? `id:${trade.externalRef}` : `row:${trade.symbol}|${trade.enteredAt}|${trade.exitedAt}|${trade.gross}|${trade.direction}`
      const duplicate = seen.has(fingerprint) || existing.some(t => t.accountId === selectedAccount && t.source === 'csv' && (trade.externalRef ? t.externalRef === trade.externalRef : t.symbol === trade.symbol && t.enteredAt === trade.enteredAt && t.exitedAt === trade.exitedAt && t.gross === trade.gross && t.direction === trade.direction))
      seen.add(fingerprint)
      return { index: index + 2, trade, error: duplicate ? 'Already imported' : '' }
    } catch (error) { return { index: index + 2, trade: null, error: error instanceof Error ? error.message : 'Invalid row' } }
  }) }, [table, columns, selectedAccount, selectedEnvironment, profitIsNet, existing])
  const valid = preview.filter(item => item.trade && !item.error).map(item => item.trade!)
  const rejected = preview.length - valid.length
  async function load(file: File) {
    try {
      const text = await file.text()
      parseCsv(text)
      setName(file.name); setRaw(text); setMapping(null); setFileError('')
    } catch (error) { setFileError(error instanceof Error ? error.message : 'Could not read CSV') }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}><div className="modal wide import-modal" role="dialog" aria-modal="true" aria-label="Import trades"><div className="modal-head"><div><div className="eyebrow">BRING YOUR HISTORY IN</div><h2>Import trades from CSV</h2></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div><div className="modal-body">
    <label className="file-drop"><Upload size={22} /><strong>{name || 'Choose a CSV file'}</strong><span>Preview rows and map columns before they enter your workspace.</span><input type="file" accept=".csv,text/csv,text/plain" onChange={e => { const file = e.target.files?.[0]; if (file) void load(file) }} /></label>
    {fileError && <p className="import-error"><AlertCircle size={15} /> {fileError}</p>}
    {!!table.length && <><div className="form-grid three"><label className="field"><span>Delimiter</span><select value={delimiter} onChange={e => { setDelimiter(e.target.value); setMapping(null) }}><option value=",">Comma</option><option value=";">Semicolon</option><option value="\t">Tab</option></select></label><label className="field"><span>Account</span><select value={selectedAccount} onChange={e => setSelectedAccount(e.target.value)}>{accounts.map(a => <option value={a.id} key={a.id}>{a.name} · {a.currency}</option>)}</select></label><label className="field"><span>Environment</span><select value={selectedEnvironment} onChange={e => setSelectedEnvironment(e.target.value as Environment)}><option value="demo">Demo</option><option value="live">Live</option><option value="backtest">Backtest</option></select></label></div><label className="import-checkbox"><input type="checkbox" checked={profitIsNet} onChange={e => setProfitIsNet(e.target.checked)} /> Profit column is already net of fees, spread, and swap</label><p className="form-help">Dates must include an unambiguous year. Imported prices, size, and risk are optional. Rows with missing fields or duplicate IDs are skipped.</p><div className="import-mapping">{importFields.map(field => <label key={field.key}><span>{field.label}{(['symbol','direction','enteredAt','gross'] as ImportField[]).includes(field.key) ? ' *' : ''}</span><select value={columns[field.key]} onChange={e => setMapping({ ...columns, [field.key]: Number(e.target.value) })}><option value={-1}>Do not import</option>{headers.map((header, index) => <option value={index} key={index}>{header || `Column ${index + 1}`}</option>)}</select></label>)}</div><div className="import-summary"><Check size={16} /> {valid.length} ready to import <span>{rejected} skipped or invalid</span></div><div className="import-preview"><table><thead><tr><th>ROW</th><th>INSTRUMENT</th><th>DATE</th><th>RESULT</th><th>STATUS</th></tr></thead><tbody>{preview.slice(0, 12).map(item => <tr key={item.index}><td>{item.index}</td><td>{item.trade?.symbol || '—'}</td><td>{item.trade?.exitedAt || '—'}</td><td>{item.trade?.gross ?? '—'}</td><td className={item.error ? 'negative' : 'positive'}>{item.error || 'Ready'}</td></tr>)}</tbody></table></div>{preview.length > 12 && <p className="form-help">Showing the first 12 of {preview.length} rows.</p>}</>}
  </div><div className="modal-foot"><button className="button ghost" onClick={onClose}>Cancel</button><button className="button primary" disabled={!valid.length} onClick={() => onImport(valid)}>Import {valid.length} trades</button></div></div></div>
}
