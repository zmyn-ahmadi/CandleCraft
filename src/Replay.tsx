import { useEffect, useRef, useState } from 'react'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Pause, Play, SkipForward, Upload } from 'lucide-react'
import { net, rMultiple, uid, type ReplayDataset, type Strategy, type Trade } from './model'
import { readCandles, replayOrderError } from './replayData'
import { availableTimeframes } from './replayChartData'
import ReplayChart from './ReplayChart'

export { readCandles } from './replayData'
type ReplayChange = ReplayDataset | ((previous?: ReplayDataset) => ReplayDataset)
export interface ReplayOrder { direction: 'long' | 'short'; entry: number; stop: number; target: number; risk: number; strategyId: string }
const num = (value: string) => value.trim() === '' ? NaN : Number(value)
const fmtR = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`

export default function Replay({ dataset, onChange, onRecord, sessionTrades, strategies, onTakeTrade }: { dataset?: ReplayDataset; onChange: (change: ReplayChange) => void; onRecord: () => void; sessionTrades: Trade[]; strategies: Strategy[]; onTakeTrade: (order: ReplayOrder) => void }) {
  const [direction, setDirection] = useState<'long' | 'short'>('long')
  const [stop, setStop] = useState('')
  const [target, setTarget] = useState('')
  const [risk, setRisk] = useState('100')
  const [strategyId, setStrategyId] = useState('')
  const [symbol, setSymbol] = useState('')
  const [error, setError] = useState('')
  const [playing, setPlaying] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const patch = (value: Partial<ReplayDataset>) => {
    if (!dataset) return
    onChange(previous => previous && previous.id !== dataset.id ? previous : ({ ...(previous || dataset), ...value }))
  }
  const step = () => {
    if (!dataset) return
    onChange(previous => {
      const current = previous || dataset
      if (current.id !== dataset.id) return current
      return { ...current, cursor: Math.min(current.cursor + 1, current.candles.length - 1) }
    })
  }
  useEffect(() => {
    if (!playing || !dataset) return
    if (dataset.cursor >= dataset.candles.length - 1) { setPlaying(false); return }
    const timer = window.setTimeout(() => onChange(previous => {
      const current = previous || dataset
      if (current.id !== dataset.id) return current
      return { ...current, cursor: Math.min(current.cursor + 1, current.candles.length - 1) }
    }), 650)
    return () => window.clearTimeout(timer)
  }, [playing, dataset, onChange])
  async function importFile(file: File) {
    try {
      const candles = readCandles(await file.text())
      const inferredSymbol = file.name.match(/^([a-z0-9.]+)[_-]/i)?.[1]?.toUpperCase()
      onChange({ id: uid(), name: file.name, symbol: symbol.trim().toUpperCase() || inferredSymbol || 'UNKNOWN', candles, cursor: Math.min(29, candles.length - 1), importedAt: new Date().toISOString(), drawings: [], timeframe: 'source' })
      setPlaying(false)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not import candles') }
  }
  const entry = dataset?.candles[dataset.cursor].close ?? NaN
  const orderError = replayOrderError(direction, entry, num(stop), num(target), num(risk))
  const rewardRisk = Math.abs(num(target) - entry) / Math.abs(entry - num(stop))
  const closed = sessionTrades.filter(t => t.status === 'closed' && net(t) != null)
  const open = sessionTrades.filter(t => t.status === 'open')
  const rs = closed.map(rMultiple).filter((r): r is number => r != null)
  const placeOrder = () => { if (orderError || !dataset) return; onTakeTrade({ direction, entry, stop: num(stop), target: num(target), risk: num(risk), strategyId }); setStop(''); setTarget('') }
  const timeframes = dataset ? availableTimeframes(dataset.candles, dataset.name) : []
  const timeframe = dataset?.timeframe && timeframes.some(option => option.value === dataset.timeframe) ? dataset.timeframe : 'source'
  return <div className="replay-layout">
    <section className="card replay-main" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && event.code === 'Space' && dataset && !playing && dataset.cursor < dataset.candles.length - 1) { event.preventDefault(); step() } }}>
      <div className="replay-head"><div><div className="eyebrow">MANUAL CANDLE REPLAY</div><h2>{dataset ? `${dataset.symbol} · ${dataset.name}` : 'A chart that reveals one candle at a time'}</h2><p>{dataset ? `${dataset.cursor + 1} of ${dataset.candles.length} candles revealed · ${new Date(dataset.candles[dataset.cursor].time).toLocaleString()}` : 'Import your own OHLC CSV to practice reading a setup without future price data.'}</p></div>{dataset && <span className="replay-count">{Math.round((dataset.cursor + 1) / dataset.candles.length * 100)}% revealed</span>}</div>
      {dataset ? <><ReplayChart candles={dataset.candles.slice(0, dataset.cursor + 1)} drawings={(dataset.drawings || []).filter(drawing => drawing.a.index <= dataset.cursor && (!drawing.b || drawing.b.index <= dataset.cursor))} onDrawingsChange={drawings => { setPlaying(false); patch({ drawings }) }} symbol={dataset.symbol} timeframe={timeframe} onTimeframeChange={value => patch({ timeframe: value })} timeframes={timeframes} />
        <div className="replay-controls"><button className="button secondary" onClick={() => setPlaying(!playing)} disabled={dataset.cursor >= dataset.candles.length - 1}>{playing ? <Pause size={16}/> : <Play size={16}/>} {playing ? 'Pause' : 'Play'}</button><button className="button primary" onClick={step} disabled={dataset.cursor >= dataset.candles.length - 1}><SkipForward size={16}/> Next candle</button><button className="button ghost" onClick={onRecord}>Record manually <ArrowRight size={16}/></button><span>Space to step when this panel is focused</span></div></> : <div className="replay-empty"><div className="replay-empty-art"><span/><span/><span/><span/><span/><span/><span/></div><h3>Bring your own market history</h3><p>Import a CSV with date, open, high, low, close, and optional volume. Newest-first files are supported.</p></div>}
    </section>
    <aside className="card replay-side">{dataset && <><div className="replay-order"><h3>Take a trade</h3><div className="direction-toggle">{(['long', 'short'] as const).map(d => <button type="button" key={d} className={`${d}${direction === d ? ' selected' : ''}`} onClick={() => setDirection(d)}>{d === 'long' ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}{d === 'long' ? 'Long' : 'Short'}</button>)}</div><p className="replay-entry">Entry at this candle's close: <strong>{entry}</strong></p><div className="form-grid"><label className="field"><span>Stop</span><input type="number" step="any" value={stop} onChange={e => setStop(e.target.value)} /></label><label className="field"><span>Target</span><input type="number" step="any" value={target} onChange={e => setTarget(e.target.value)} /></label><label className="field"><span>Risk amount</span><input type="number" step="any" min="0" value={risk} onChange={e => setRisk(e.target.value)} /></label><label className="field"><span>Strategy</span><select value={strategyId} onChange={e => setStrategyId(e.target.value)}><option value="">No strategy</option>{strategies.filter(s => !s.archived).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>{stop && target && orderError ? <p className="import-error">{orderError}</p> : !orderError && <p className="form-help">Reward to risk {rewardRisk.toFixed(2)} : 1</p>}<button className="button primary" disabled={!!orderError || dataset.cursor >= dataset.candles.length - 1} onClick={placeOrder}>Enter {direction} at {entry}</button><p className="form-help">The trade closes on the candle that reaches your stop or target. If one candle reaches both, it counts as stopped out.</p></div>
      <div className="replay-session"><h3>This session</h3><div className="replay-session-stats"><div><span>Closed</span><strong>{closed.length}</strong></div><div><span>Win rate</span><strong>{closed.length ? `${Math.round(closed.filter(t => net(t)! > 0).length / closed.length * 100)}%` : '—'}</strong></div><div><span>Net R</span><strong className={rs.reduce((a, b) => a + b, 0) > 0 ? 'positive' : rs.reduce((a, b) => a + b, 0) < 0 ? 'negative' : ''}>{rs.length ? fmtR(rs.reduce((a, b) => a + b, 0)) : '—'}</strong></div></div>{[...open, ...closed.slice(-5).reverse()].map(t => <div className="replay-session-trade" key={t.id}><span className={`direction ${t.direction}`}>{t.direction === 'long' ? '↗' : '↘'} {t.direction}</span><span>@ {t.entryPrice}</span>{t.status === 'open' ? <em>open</em> : <strong className={net(t)! < 0 ? 'negative' : 'positive'}>{t.exitReason === 'stop' ? 'Stop' : 'Target'} {fmtR(rMultiple(t) ?? 0)}</strong>}</div>)}</div></>}
      <div className="eyebrow">DATASET</div><h3>{dataset ? 'Dataset' : 'Start a session'}</h3><p>Only revealed candles enter the chart and indicators. Your replay cursor, timeframe, and drawings are saved with the workspace.</p><label className="field"><span>Instrument</span><input value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="Auto-detect from filename" /></label><button className="button secondary" onClick={() => fileRef.current?.click()}><Upload size={16}/> {dataset ? 'Import another dataset' : 'Import OHLC CSV'}</button><input ref={fileRef} hidden type="file" accept=".csv,text/csv,text/plain" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }}/>{error && <p className="import-error">{error}</p>}<div className="replay-note"><strong>Chart tools</strong><p>Switch between the source interval and larger UTC periods. Drag in select mode to pan, or click a drawing to edit or delete it. Indicators become available when enough bars are revealed.{dataset && dataset.candles.length < 20 ? ` This dataset has ${dataset.candles.length} candles, so longer-period indicators need more history.` : ''}</p></div><div className="replay-note"><strong>Replay rules</strong><p>Decide after a candle closes. Trades you take here fill at the candle close and exit automatically at the stop or target; costs are not included. Use Record manually for anything else.</p></div></aside>
  </div>
}
