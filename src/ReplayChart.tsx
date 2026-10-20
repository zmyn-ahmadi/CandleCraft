import { useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { ArrowLeft, ArrowRight, Crosshair, Minus, MousePointer2, RotateCcw, Square, TrendingUp, ZoomIn, ZoomOut, Trash2, Ruler, MoveVertical, GitBranch, Activity } from 'lucide-react'
import { uid, type Candle, type ReplayDrawing, type ReplayPoint } from './model'
import { sma } from './replayData'
import { aggregateCandles, barForPoint, ema, rsi, type Timeframe } from './replayChartData'

type Tool = 'cursor' | ReplayDrawing['type']
type Drag = { id: string; end: 'a' | 'b' }
const green = '#80d5b3', red = '#ef9c9d', blue = '#86b9ed', gold = '#e7c288', purple = '#c6a7e9'
const shortDate = (time: string) => new Date(time).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit', timeZone: 'UTC' })
const priceText = (price: number) => Math.abs(price) >= 100 ? price.toFixed(2) : Math.abs(price) >= 1 ? price.toFixed(4) : price.toFixed(6)
const drawingTools = [
  { value: 'cursor', icon: MousePointer2, label: 'Select and pan' },
  { value: 'trend', icon: TrendingUp, label: 'Trendline' },
  { value: 'ray', icon: GitBranch, label: 'Ray' },
  { value: 'horizontal', icon: Minus, label: 'Horizontal level' },
  { value: 'vertical', icon: MoveVertical, label: 'Vertical marker' },
  { value: 'rectangle', icon: Square, label: 'Price zone' },
  { value: 'fib', icon: Activity, label: 'Fibonacci retracement' },
  { value: 'measure', icon: Ruler, label: 'Measure move' },
] as const

export default function ReplayChart({ candles, drawings, onDrawingsChange, symbol, timeframe, onTimeframeChange, timeframes }: {
  candles: Candle[]; drawings: ReplayDrawing[]; onDrawingsChange: (value: ReplayDrawing[]) => void; symbol: string
  timeframe: Timeframe; onTimeframeChange: (value: Timeframe) => void; timeframes: { value: Timeframe; label: string }[]
}) {
  const host = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const dragDraft = useRef<ReplayDrawing | null>(null)
  const suppressClick = useRef(false)
  const panStart = useRef<{ x: number; offset: number; captured: boolean } | null>(null)
  const [width, setWidth] = useState(900)
  const [windowSize, setWindowSize] = useState(80)
  const [offset, setOffset] = useState(0)
  const [tool, setTool] = useState<Tool>('cursor')
  const [start, setStart] = useState<ReplayPoint | null>(null)
  const [hover, setHover] = useState<ReplayPoint | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [draft, setDraft] = useState<ReplayDrawing | null>(null)
  const [showSma20, setShowSma20] = useState(false)
  const [showSma50, setShowSma50] = useState(false)
  const [showEma20, setShowEma20] = useState(false)
  const [showRsi, setShowRsi] = useState(false)
  const [showVolume, setShowVolume] = useState(true)
  const [chartStyle, setChartStyle] = useState<'candles' | 'line'>('candles')
  useEffect(() => {
    if (!host.current) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(400, Math.round(entries[0].contentRect.width))))
    observer.observe(host.current)
    return () => observer.disconnect()
  }, [])
  const bars = useMemo(() => aggregateCandles(candles, timeframe), [candles, timeframe])
  const values = useMemo(() => bars.map(bar => bar.candle), [bars])
  const maxOffset = Math.max(0, bars.length - windowSize)
  useEffect(() => { setOffset(0); setStart(null); setHover(null); setSelectedId(null) }, [timeframe])
  useEffect(() => { setOffset(value => Math.min(value, maxOffset)) }, [maxOffset])
  useEffect(() => { setStart(null) }, [tool])
  const height = 520, left = 16, right = 77, top = 48, bottom = 42
  const plotRight = width - right, plotWidth = plotRight - left
  const hasVolume = showVolume && bars.some(bar => bar.candle.volume !== undefined)
  const hasRsi = showRsi && bars.length >= 15
  const plotBottom = height - bottom - 7 - (hasVolume ? 63 : 0) - (hasRsi ? 87 : 0)
  const volumeTop = plotBottom + 12
  const volumeBottom = hasVolume ? volumeTop + 48 : plotBottom
  const rsiTop = (hasVolume ? volumeBottom : plotBottom) + 12
  const rsiBottom = rsiTop + 73
  const safeOffset = Math.min(offset, maxOffset)
  const end = Math.max(0, bars.length - 1 - safeOffset)
  const first = Math.max(0, end - windowSize + 1)
  const visible = bars.slice(first, end + 1)
  const visibleCapacity = Math.min(bars.length, windowSize)
  const step = plotWidth / Math.max(visibleCapacity, 2)
  const x = (index: number) => left + (index - first + .5) * step
  const xPoint = (point: ReplayPoint) => x(barForPoint(bars, point))
  const prices = visible.flatMap(bar => [bar.candle.high, bar.candle.low])
  const min = Math.min(...prices), max = Math.max(...prices)
  const padding = Math.max((max - min) * .14, Math.abs(max) * .006, .001)
  const low = min - padding, high = max + padding, span = high - low
  const y = (price: number) => top + (high - price) / span * (plotBottom - top)
  const priceAt = (pixel: number) => high - (pixel - top) / (plotBottom - top) * span
  const recent = visible.at(-1)?.candle
  const moving20 = useMemo(() => sma(values, 20), [values])
  const moving50 = useMemo(() => sma(values, 50), [values])
  const exponential20 = useMemo(() => ema(values, 20), [values])
  const relativeStrength = useMemo(() => rsi(values), [values])
  const maxVolume = Math.max(1, ...visible.map(bar => bar.candle.volume || 0))
  const selected = hover && barForPoint(bars, hover) >= first && barForPoint(bars, hover) <= end ? bars[barForPoint(bars, hover)] : visible.at(-1)
  const selectedDrawing = drawings.find(drawing => drawing.id === selectedId)
  function coordinates(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>) {
    const box = svg.current!.getBoundingClientRect()
    return { px: (event.clientX - box.left) * width / box.width, py: (event.clientY - box.top) * height / box.height }
  }
  function pointFromEvent(event: MouseEvent<SVGSVGElement> | PointerEvent<SVGSVGElement>): ReplayPoint | null {
    if (!svg.current) return null
    const { px, py } = coordinates(event)
    if (px < left || px > plotRight || py < top || py > plotBottom) return null
    const index = Math.max(first, Math.min(end, Math.floor((px - left) / step + first)))
    return { index: bars[index].endIndex, price: priceAt(py) }
  }
  function onChartClick(event: MouseEvent<SVGSVGElement>) {
    if (suppressClick.current) { suppressClick.current = false; return }
    const point = pointFromEvent(event)
    if (tool === 'cursor') { setSelectedId(null); return }
    if (!point) return
    if (tool === 'horizontal' || tool === 'vertical') { onDrawingsChange([...drawings, { id: uid(), type: tool, a: point }]); return }
    if (!start) { setStart(point); return }
    if (start.index === point.index && Math.abs(start.price - point.price) < span * .001) return
    onDrawingsChange([...drawings, { id: uid(), type: tool, a: start, b: point }])
    setStart(null)
  }
  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    const point = pointFromEvent(event)
    setHover(point)
    if (drag && point) {
      const drawing = drawings.find(item => item.id === drag.id)
      if (drawing) {
        const changed = { ...drawing, [drag.end]: point }
        dragDraft.current = changed
        setDraft(changed)
      }
    } else if (panStart.current) {
      const { px } = coordinates(event)
      if (!panStart.current.captured && Math.abs(px - panStart.current.x) > 3) { svg.current?.setPointerCapture(event.pointerId); panStart.current.captured = true }
      const delta = Math.round((px - panStart.current.x) / step)
      setOffset(Math.max(0, Math.min(maxOffset, panStart.current.offset + delta)))
      if (delta) suppressClick.current = true
    }
  }
  function finishPointer() {
    if (dragDraft.current) onDrawingsChange(drawings.map(item => item.id === dragDraft.current!.id ? dragDraft.current! : item))
    if (drag) suppressClick.current = true
    dragDraft.current = null
    setDraft(null)
    setDrag(null)
    panStart.current = null
  }
  function startHandle(event: PointerEvent<SVGCircleElement>, id: string, end: 'a' | 'b') {
    event.stopPropagation()
    setSelectedId(id)
    setDrag({ id, end })
    svg.current?.setPointerCapture(event.pointerId)
  }
  function removeSelected() {
    if (selectedId) onDrawingsChange(drawings.filter(item => item.id !== selectedId))
    setSelectedId(null)
  }
  const pathFor = (series: (number | null)[], projection = y) => {
    let path = ''
    for (let i = first; i <= end; i++) if (series[i] != null) path += `${path ? ' L' : 'M'} ${x(i).toFixed(1)} ${projection(series[i]!).toFixed(1)}`
    return path
  }
  function displayDrawing(original: ReplayDrawing, isDraft = false) {
    const drawing = draft?.id === original.id ? draft : original
    const ax = xPoint(drawing.a), ay = y(drawing.a.price)
    const bx = drawing.b ? xPoint(drawing.b) : ax, by = drawing.b ? y(drawing.b.price) : ay
    const color = drawing.type === 'trend' || drawing.type === 'ray' ? blue : drawing.type === 'rectangle' || drawing.type === 'fib' ? gold : drawing.type === 'measure' ? green : purple
    const lineProps = { stroke: color, strokeWidth: isDraft ? 1.4 : 1.8, strokeDasharray: isDraft ? '5 5' : undefined }
    const select = (event: MouseEvent<SVGGElement>) => { event.stopPropagation(); setSelectedId(drawing.id); suppressClick.current = false }
    const handles = !isDraft && selectedId === drawing.id ? <g><circle cx={ax} cy={ay} r="6" fill={color} stroke="#14212b" strokeWidth="2" onPointerDown={event => startHandle(event, drawing.id, 'a')} />{drawing.b && <circle cx={bx} cy={by} r="6" fill={color} stroke="#14212b" strokeWidth="2" onPointerDown={event => startHandle(event, drawing.id, 'b')} />}</g> : null
    if (drawing.type === 'horizontal') return <g key={drawing.id} onPointerDown={event => event.stopPropagation()} onClick={select}><line x1={left} x2={plotRight} y1={ay} y2={ay} {...lineProps} strokeWidth="9" opacity="0"/><line x1={left} x2={plotRight} y1={ay} y2={ay} {...lineProps} pointerEvents="none"/><text x={plotRight-5} y={ay-5} textAnchor="end" fill={color} fontSize="10" pointerEvents="none">{priceText(drawing.a.price)}</text>{handles}</g>
    if (drawing.type === 'vertical') return <g key={drawing.id} onPointerDown={event => event.stopPropagation()} onClick={select}><line x1={ax} x2={ax} y1={top} y2={plotBottom} {...lineProps} strokeWidth="9" opacity="0"/><line x1={ax} x2={ax} y1={top} y2={plotBottom} {...lineProps} pointerEvents="none"/>{handles}</g>
    if (!drawing.b) return null
    if (drawing.type === 'rectangle') return <g key={drawing.id} onPointerDown={event => event.stopPropagation()} onClick={select}><rect x={Math.min(ax,bx)} y={Math.min(ay,by)} width={Math.max(2,Math.abs(bx-ax))} height={Math.max(2,Math.abs(by-ay))} fill="rgba(231,194,136,.12)" {...lineProps}/>{handles}</g>
    if (drawing.type === 'fib') return <g key={drawing.id} onPointerDown={event => event.stopPropagation()} onClick={select}>{[0,.236,.382,.5,.618,.786,1].map(level => { const py=ay+(by-ay)*level; return <g key={level}><line x1={Math.min(ax,bx)} x2={plotRight} y1={py} y2={py} {...lineProps} opacity={level===0||level===1?.9:.68} /><text x={plotRight-4} y={py-4} textAnchor="end" fill={color} fontSize="10" pointerEvents="none">{(level*100).toFixed(1)}% · {priceText(drawing.a.price+(drawing.b!.price-drawing.a.price)*level)}</text></g> })}{handles}</g>
    if (drawing.type === 'measure') { const change=drawing.b.price-drawing.a.price, percent=drawing.a.price ? change/drawing.a.price*100 : 0; return <g key={drawing.id} onPointerDown={event => event.stopPropagation()} onClick={select}><line x1={ax} y1={ay} x2={bx} y2={by} {...lineProps} strokeWidth="9" opacity="0"/><line x1={ax} y1={ay} x2={bx} y2={by} {...lineProps} pointerEvents="none"/><rect x={(ax+bx)/2-57} y={(ay+by)/2-22} width="114" height="20" rx="4" fill="#263846"/><text x={(ax+bx)/2} y={(ay+by)/2-8} textAnchor="middle" fill={color} fontSize="10" pointerEvents="none">{change>=0?'+':''}{priceText(change)} ({percent.toFixed(2)}%)</text>{handles}</g> }
    const rayX = drawing.type === 'ray' && bx !== ax ? (bx>ax?plotRight:left) : bx
    const rayY = drawing.type === 'ray' && bx !== ax ? ay+(by-ay)*(rayX-ax)/(bx-ax) : by
    return <g key={drawing.id} onPointerDown={event => event.stopPropagation()} onClick={select}><line x1={ax} y1={ay} x2={rayX} y2={rayY} {...lineProps} strokeWidth="9" opacity="0"/><line x1={ax} y1={ay} x2={rayX} y2={rayY} {...lineProps} pointerEvents="none"/>{handles}</g>
  }
  const hint = start ? 'Choose the second point · Esc cancels' : tool === 'cursor' ? selectedDrawing ? 'Drag a handle to edit · Delete removes selected drawing' : 'Drag to pan · hover for OHLC · select drawings to edit' : tool === 'horizontal' || tool === 'vertical' ? 'Click once to place a marker' : 'Click two points to place a drawing'
  return <div className="replay-terminal">
    <div className="replay-terminal-head"><div><span className="replay-live-dot" /> <strong>{symbol}</strong><span> · {timeframes.find(t => t.value === timeframe)?.label || 'Source'} · {visible.length} bars in view</span></div><div className="replay-chart-legend"><span style={{ color: green }}>● Bullish</span><span style={{ color: red }}>● Bearish</span></div></div>
    <div className="replay-timeframes" role="group" aria-label="Chart timeframe"><span>TIMEFRAME</span>{timeframes.map(item => <button key={item.value} type="button" className={timeframe === item.value ? 'active' : ''} aria-pressed={timeframe === item.value} onClick={() => onTimeframeChange(item.value)}>{item.label}</button>)}<small>Source interval and larger · UTC</small></div>
    <div className="replay-toolbar" aria-label="Chart tools">
      {drawingTools.map(({ value, icon: Icon, label }) => <button key={value} type="button" className={tool === value ? 'active' : ''} title={label} aria-label={label} aria-pressed={tool === value} onClick={() => { setTool(value); setStart(null); setSelectedId(null) }}><Icon size={16}/></button>)}
      <span className="replay-toolbar-separator" />
      <button type="button" title={bars.length < 20 ? 'Needs 20 revealed bars' : '20 period simple moving average'} className={showSma20 ? 'active' : ''} aria-pressed={showSma20} disabled={bars.length < 20} onClick={() => setShowSma20(!showSma20)}>SMA 20</button>
      <button type="button" title={bars.length < 50 ? 'Needs 50 revealed bars' : '50 period simple moving average'} className={showSma50 ? 'active' : ''} aria-pressed={showSma50} disabled={bars.length < 50} onClick={() => setShowSma50(!showSma50)}>SMA 50</button>
      <button type="button" title={bars.length < 20 ? 'Needs 20 revealed bars' : '20 period exponential moving average'} className={showEma20 ? 'active' : ''} aria-pressed={showEma20} disabled={bars.length < 20} onClick={() => setShowEma20(!showEma20)}>EMA 20</button>
      <button type="button" title={bars.length < 15 ? 'Needs 15 revealed bars' : '14 period RSI'} className={hasRsi ? 'active' : ''} aria-pressed={hasRsi} disabled={bars.length < 15} onClick={() => setShowRsi(!showRsi)}>RSI 14</button>
      <button type="button" title={bars.some(bar => bar.candle.volume !== undefined) ? 'Toggle volume' : 'No volume in this CSV'} className={showVolume && hasVolume ? 'active' : ''} aria-pressed={showVolume && hasVolume} disabled={!bars.some(bar => bar.candle.volume !== undefined)} onClick={() => setShowVolume(!showVolume)}>VOL</button>
      <button type="button" title="Switch between candles and close line" onClick={() => setChartStyle(chartStyle === 'candles' ? 'line' : 'candles')}>{chartStyle === 'candles' ? 'CANDLES' : 'LINE'}</button>
      <span className="replay-toolbar-spacer" />
      <button type="button" title="Older candles" aria-label="Older candles" disabled={safeOffset >= maxOffset} onClick={() => setOffset(Math.min(maxOffset,safeOffset+Math.max(1,Math.floor(windowSize/3))))}><ArrowLeft size={15}/></button>
      <button type="button" title="Latest candles" aria-label="Latest candles" disabled={safeOffset === 0} onClick={() => setOffset(0)}><ArrowRight size={15}/></button>
      <button type="button" title={visibleCapacity <= 2 ? 'More bars needed to zoom in' : 'Zoom in'} aria-label="Zoom in" disabled={visibleCapacity <= 2} onClick={() => setWindowSize(Math.max(2,Math.floor(visibleCapacity*.75)))}><ZoomIn size={16}/></button>
      <button type="button" title={visibleCapacity >= bars.length ? 'All revealed bars are visible' : 'Zoom out'} aria-label="Zoom out" disabled={visibleCapacity >= bars.length || windowSize >= 240} onClick={() => setWindowSize(Math.min(240,Math.ceil(visibleCapacity*1.33)))}><ZoomOut size={16}/></button>
      <button type="button" title="Undo last drawing" aria-label="Undo last drawing" disabled={!drawings.length} onClick={() => { onDrawingsChange(drawings.slice(0,-1)); setSelectedId(null) }}><RotateCcw size={15}/></button>
      <button type="button" title="Delete selected drawing" aria-label="Delete selected drawing" disabled={!selectedDrawing} onClick={removeSelected}><Trash2 size={15}/></button>
      <button type="button" title="Clear all drawings" aria-label="Clear all drawings" disabled={!drawings.length} onClick={() => { onDrawingsChange([]); setStart(null); setSelectedId(null) }}>Clear</button>
    </div>
    <div ref={host} className="replay-chart" onKeyDown={event => { if (event.key === 'Escape') { setStart(null); setTool('cursor'); setSelectedId(null) } if ((event.key === 'Delete' || event.key === 'Backspace') && selectedDrawing) { event.preventDefault(); removeSelected() } }}>
      <svg ref={svg} tabIndex={0} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Revealed ${timeframes.find(t => t.value === timeframe)?.label || 'source'} chart for ${symbol}`} onClick={onChartClick} onPointerDown={event => { if (tool === 'cursor' && !drag) { const {px}=coordinates(event); panStart.current={x:px,offset:safeOffset,captured:false} } }} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} onMouseLeave={() => { if (!drag && !panStart.current) setHover(null) }} style={{ cursor: tool === 'cursor' ? 'crosshair' : 'cell', touchAction: 'none' }}>
        <defs><clipPath id="replayPlot"><rect x={left} y={top} width={plotWidth} height={plotBottom-top}/></clipPath></defs>
        {[0,1,2,3,4,5].map(i => { const py=top+i*(plotBottom-top)/5; return <g key={i}><line x1={left} x2={plotRight} y1={py} y2={py} stroke="rgba(170,195,210,.12)" strokeDasharray="3 5"/><text x={plotRight+8} y={py+4} fill="#9baebb" fontSize="10">{priceText(high-i*span/5)}</text></g> })}
        {visible.map((bar,i) => i%Math.max(1,Math.ceil(visible.length/7))===0 ? <g key={bar.startIndex}><line x1={x(first+i)} x2={x(first+i)} y1={top} y2={height-bottom} stroke="rgba(170,195,210,.055)"/><text x={x(first+i)} y={height-14} textAnchor="middle" fill="#91a3ae" fontSize="10">{shortDate(bar.candle.time)}</text></g> : null)}
        <g clipPath="url(#replayPlot)">
          {chartStyle === 'candles' ? visible.map((bar,i) => { const c=bar.candle,cx=x(first+i),color=c.close>=c.open?green:red,body=Math.max(2,Math.abs(y(c.open)-y(c.close))); return <g key={bar.startIndex} fill={color} stroke={color}><line x1={cx} x2={cx} y1={y(c.high)} y2={y(c.low)} strokeWidth="1.3"/><rect x={cx-Math.min(7,step*.34)} y={Math.min(y(c.open),y(c.close))} width={Math.min(14,step*.68)} height={body} rx="1.5" stroke="none"/></g> }) : <g><path d={visible.map((bar,i)=>`${i?'L':'M'} ${x(first+i).toFixed(1)} ${y(bar.candle.close).toFixed(1)}`).join(' ')} fill="none" stroke={green} strokeWidth="2.2"/>{visible.map((bar,i)=><circle key={bar.startIndex} cx={x(first+i)} cy={y(bar.candle.close)} r="3" fill={green}/>)}</g>}
          {showSma20 && bars.length>=20 && <path d={pathFor(moving20)} fill="none" stroke={gold} strokeWidth="1.8"/>}
          {showSma50 && bars.length>=50 && <path d={pathFor(moving50)} fill="none" stroke={blue} strokeWidth="1.8"/>}
          {showEma20 && bars.length>=20 && <path d={pathFor(exponential20)} fill="none" stroke={purple} strokeWidth="1.8"/>}
          {drawings.map(drawing => displayDrawing(drawing))}
          {start && hover && displayDrawing({ id:'draft', type:tool as ReplayDrawing['type'], a:start, b:hover }, true)}
        </g>
        {hasVolume && <g><line x1={left} x2={plotRight} y1={volumeTop-4} y2={volumeTop-4} stroke="rgba(170,195,210,.13)"/><text x={left+5} y={volumeTop+10} fill="#91a3ae" fontSize="10">VOLUME</text>{visible.map((bar,i) => { const c=bar.candle,h=(c.volume||0)/maxVolume*43; return <rect key={bar.startIndex} x={x(first+i)-Math.min(7,step*.34)} y={volumeBottom-h} width={Math.min(14,step*.68)} height={h} fill={c.close>=c.open?green:red} opacity=".55"/> })}</g>}
        {hasRsi && <g><line x1={left} x2={plotRight} y1={rsiTop} y2={rsiTop} stroke="rgba(170,195,210,.13)"/><text x={left+5} y={rsiTop+12} fill="#91a3ae" fontSize="10">RSI 14</text>{[30,70].map(level => <g key={level}><line x1={left} x2={plotRight} y1={rsiBottom-level/100*(rsiBottom-rsiTop)} y2={rsiBottom-level/100*(rsiBottom-rsiTop)} stroke="rgba(170,195,210,.13)" strokeDasharray="3 5"/><text x={plotRight+8} y={rsiBottom-level/100*(rsiBottom-rsiTop)+4} fill="#91a3ae" fontSize="10">{level}</text></g>)}<path d={pathFor(relativeStrength, value => rsiBottom-value/100*(rsiBottom-rsiTop))} fill="none" stroke={gold} strokeWidth="1.8"/></g>}
        {hover && <g pointerEvents="none"><line x1={xPoint(hover)} x2={xPoint(hover)} y1={top} y2={height-bottom} stroke="rgba(223,235,240,.48)" strokeDasharray="4 4"/><line x1={left} x2={plotRight} y1={y(hover.price)} y2={y(hover.price)} stroke="rgba(223,235,240,.48)" strokeDasharray="4 4"/><rect x={plotRight} y={y(hover.price)-10} width={right} height="20" fill="#8eafbe"/><text x={plotRight+5} y={y(hover.price)+4} fill="#14232b" fontSize="10" fontWeight="700">{priceText(hover.price)}</text></g>}
        {recent && <g pointerEvents="none"><line x1={left} x2={plotRight} y1={y(recent.close)} y2={y(recent.close)} stroke={recent.close>=recent.open?green:red} strokeDasharray="4 4" opacity=".65"/><rect x={plotRight} y={y(recent.close)-11} width={right} height="22" rx="3" fill={recent.close>=recent.open?green:red}/><text x={plotRight+5} y={y(recent.close)+4} fill="#16262c" fontSize="11" fontWeight="800">{priceText(recent.close)}</text></g>}
      </svg>
      {selected && <div className="replay-ohlc"><strong>{shortDate(selected.candle.time)}{selected.endIndex>selected.startIndex?` – ${shortDate(candles[selected.endIndex].time)}`:''}</strong><span>O {priceText(selected.candle.open)}</span><span>H {priceText(selected.candle.high)}</span><span>L {priceText(selected.candle.low)}</span><span>C {priceText(selected.candle.close)}</span>{selected.candle.volume!==undefined && <span>VOL {selected.candle.volume.toLocaleString()}</span>}</div>}
    </div>
    <div className="replay-chart-foot"><span><Crosshair size={13}/>{hint}</span><span>{drawings.length} drawing{drawings.length===1?'':'s'} saved · {bars.length} revealed {timeframe==='source'?'candles':'bars'}</span></div>
  </div>
}
