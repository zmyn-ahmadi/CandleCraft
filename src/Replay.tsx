import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Pause, Play, SkipForward, Upload } from 'lucide-react'
import { uid, type ReplayDataset } from './model'
import { readCandles } from './replayData'
import { availableTimeframes } from './replayChartData'
import ReplayChart from './ReplayChart'

export { readCandles } from './replayData'
type ReplayChange = ReplayDataset | ((previous?: ReplayDataset) => ReplayDataset)

export default function Replay({ dataset, onChange, onRecord }: { dataset?: ReplayDataset; onChange: (change: ReplayChange) => void; onRecord: () => void }) {
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
  const timeframes = dataset ? availableTimeframes(dataset.candles, dataset.name) : []
  const timeframe = dataset?.timeframe && timeframes.some(option => option.value === dataset.timeframe) ? dataset.timeframe : 'source'
  return <div className="replay-layout">
    <section className="card replay-main" tabIndex={0} onKeyDown={event => { if (event.target === event.currentTarget && event.code === 'Space' && dataset && !playing && dataset.cursor < dataset.candles.length - 1) { event.preventDefault(); step() } }}>
      <div className="replay-head"><div><div className="eyebrow">MANUAL CANDLE REPLAY</div><h2>{dataset ? `${dataset.symbol} · ${dataset.name}` : 'A chart that reveals one candle at a time'}</h2><p>{dataset ? `${dataset.cursor + 1} of ${dataset.candles.length} candles revealed · ${new Date(dataset.candles[dataset.cursor].time).toLocaleString()}` : 'Import your own OHLC CSV to practice reading a setup without future price data.'}</p></div>{dataset && <span className="replay-count">{Math.round((dataset.cursor + 1) / dataset.candles.length * 100)}% revealed</span>}</div>
      {dataset ? <><ReplayChart candles={dataset.candles.slice(0, dataset.cursor + 1)} drawings={(dataset.drawings || []).filter(drawing => drawing.a.index <= dataset.cursor && (!drawing.b || drawing.b.index <= dataset.cursor))} onDrawingsChange={drawings => { setPlaying(false); patch({ drawings }) }} symbol={dataset.symbol} timeframe={timeframe} onTimeframeChange={value => patch({ timeframe: value })} timeframes={timeframes} />
        <div className="replay-controls"><button className="button secondary" onClick={() => setPlaying(!playing)} disabled={dataset.cursor >= dataset.candles.length - 1}>{playing ? <Pause size={16}/> : <Play size={16}/>} {playing ? 'Pause' : 'Play'}</button><button className="button primary" onClick={step} disabled={dataset.cursor >= dataset.candles.length - 1}><SkipForward size={16}/> Next candle</button><button className="button secondary" onClick={onRecord}>Record backtest trade <ArrowRight size={16}/></button><span>Space to step when this panel is focused</span></div></> : <div className="replay-empty"><div className="replay-empty-art"><span/><span/><span/><span/><span/><span/><span/></div><h3>Bring your own market history</h3><p>Import a CSV with date, open, high, low, close, and optional volume. Newest-first files are supported.</p></div>}
    </section>
    <aside className="card replay-side"><div className="eyebrow">DATASET</div><h3>{dataset ? 'Replay session' : 'Start a session'}</h3><p>Only revealed candles enter the chart and indicators. Your replay cursor, timeframe, and drawings are saved with the workspace.</p><label className="field"><span>Instrument</span><input value={symbol} onChange={event => setSymbol(event.target.value)} placeholder="Auto-detect from filename" /></label><button className="button secondary" onClick={() => fileRef.current?.click()}><Upload size={16}/> {dataset ? 'Import another dataset' : 'Import OHLC CSV'}</button><input ref={fileRef} hidden type="file" accept=".csv,text/csv,text/plain" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }}/>{error && <p className="import-error">{error}</p>}<div className="replay-note"><strong>Chart tools</strong><p>Switch between the source interval and larger UTC periods. Drag in select mode to pan, or click a drawing to edit or delete it. Indicators become available when enough bars are revealed.{dataset && dataset.candles.length < 20 ? ` This dataset has ${dataset.candles.length} candles, so longer-period indicators need more history.` : ''}</p></div><div className="replay-note"><strong>Replay rules</strong><p>Decide after a candle closes. Record decisions and costs in a backtest trade. Manual replay does not calculate simulated fills or enforce stop execution.</p></div></aside>
  </div>
}
