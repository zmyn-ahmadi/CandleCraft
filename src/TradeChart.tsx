import { useEffect, useRef, useState } from 'react'
import { CandlestickSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts'
import { chartWindow, fetchBars, type Bar, type Mt5Settings } from './mt5'
import { cacheBars, cachedBars } from './storage'
import { money, net, type Trade } from './model'

const bar = (time: number) => time - time % 120 // M2 bar holding this time
const color = (host: HTMLElement, className: string) => { const probe = document.createElement('span'); probe.className = className; host.append(probe); const value = getComputedStyle(probe).color; probe.remove(); return value }

/** M2 chart of every day the trade touches, with the position drawn like TradingView's Long/Short Position tool. */
export default function TradeChart({ trade, settings, currency }: { trade: Trade; settings: Mt5Settings; currency: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [error, setError] = useState('')
  const link = trade.mt5!
  useEffect(() => {
    let chart: IChartApi | undefined, cancelled = false
    setError('')
    const { start, end, complete } = chartWindow(link)
    const key = `${link.symbol}:${start}:${end}`
    void (async () => {
      let bars = await cachedBars(key)
      if (!bars) {
        bars = await fetchBars(settings, link)
        if (complete && bars.length) await cacheBars(key, bars)
      }
      if (cancelled || !host.current) return
      if (!bars.length) { setError('No M2 candles for this day'); return }
      chart = draw(host.current, trade, bars, currency)
    })().catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true; chart?.remove() }
  }, [trade.id, link.closeTime, trade.initialStop, trade.target, trade.gross, settings.url, settings.token, currency])
  return <div className="journal-section trade-chart-section">{error ? <div className="inline-note">{error}</div> : <div className="trade-chart" ref={host} />}</div>
}

function draw(el: HTMLElement, trade: Trade, bars: Bar[], currency: string) {
  const link = trade.mt5!
  const css = getComputedStyle(el), muted = css.getPropertyValue('--muted').trim(), line = css.getPropertyValue('--line').trim(), ink = css.getPropertyValue('--ink').trim()
  const up = color(el, 'positive'), down = color(el, 'negative')
  const decimals = Math.min(5, Math.max(...bars.slice(-50).map(b => (String(b.close).split('.')[1] || '').length)))
  const levels = [trade.initialStop, trade.target].filter((x): x is number => x != null)
  const chart = createChart(el, {
    autoSize: true,
    layout: { background: { color: 'transparent' }, textColor: muted, fontFamily: css.fontFamily, attributionLogo: true },
    grid: { vertLines: { visible: false }, horzLines: { color: line } },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: .14, bottom: .14 } }, // room for the labels above TP and below SL
    timeScale: { borderVisible: false, timeVisible: true },
    crosshair: { horzLine: { color: muted }, vertLine: { color: muted } },
  })
  const series = chart.addSeries(CandlestickSeries, {
    upColor: up, downColor: down, wickUpColor: up, wickDownColor: down, borderVisible: false, lastValueVisible: false, priceLineVisible: false,
    priceFormat: { type: 'price', precision: decimals, minMove: 10 ** -decimals },
    autoscaleInfoProvider: (auto: () => any) => { // keep SL and TP on screen
      const r = auto()
      if (r && levels.length) r.priceRange = { minValue: Math.min(r.priceRange.minValue, ...levels), maxValue: Math.max(r.priceRange.maxValue, ...levels) }
      return r
    },
  })
  series.setData(bars.map(b => ({ ...b, time: b.time as UTCTimestamp })))
  if (trade.entryPrice != null) series.createPriceLine({ price: trade.entryPrice, color: muted, lineVisible: false, axisLabelTextColor: textOn(muted) })
  if (trade.initialStop) series.createPriceLine({ price: trade.initialStop, color: down, lineVisible: false, axisLabelTextColor: textOn(down) })
  if (trade.target) series.createPriceLine({ price: trade.target, color: up, lineVisible: false, axisLabelTextColor: textOn(up) })
  const last = bars.at(-1)!
  if (trade.entryPrice != null) series.attachPrimitive(positionTool(chart, series, trade, link.closeTime ?? last.time, trade.exitPrice ?? last.close, currency, { up, down, muted, ink, decimals, font: css.fontFamily }))
  chart.timeScale().fitContent() // the whole day; scroll to zoom into the trade
  return chart
}

// Dark or light label text, whichever reads on this fill.
function textOn(fill: string) {
  const [r, g, b] = (fill.match(/[\d.]+/g) || ['0', '0', '0']).map(Number)
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#15171c' : '#ffffff'
}

type Colors = { up: string; down: string; muted: string; ink: string; decimals: number; font: string }

/**
 * TradingView-style position: a band marking when the trade was open, TP and SL zones with their edges,
 * the entry line, the path from entry to exit through every fill, and pill labels that never sit on each other.
 */
function positionTool(chart: IChartApi, series: ISeriesApi<'Candlestick'>, trade: Trade, end: number, exit: number, currency: string, c: Colors) {
  const long = trade.direction === 'long', entry = trade.entryPrice!, sl = trade.initialStop, tp = trade.target
  const risk = sl && (entry - sl) * (long ? 1 : -1) > 0 ? entry - sl : 0 // none once the stop sits in profit
  const R = (price: number) => risk ? (price - entry) / risk : null
  const signed = (n: number, text: string) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${text}`
  const rText = (n: number) => signed(n, `${Math.abs(n).toFixed(2)}R`)
  const won = (exit - entry) * (long ? 1 : -1) >= 0
  const result = net(trade), made = R(exit)
  const resultLabel = [result != null && signed(result, money(Math.abs(result), currency)), made != null && rText(made)].filter(Boolean).join('  ·  ')
  const zones: { price: number; fill: string; label: string }[] = []
  if (tp) zones.push({ price: tp, fill: c.up, label: `TP  ${tp.toFixed(c.decimals)}${R(tp) ? '  ·  ' + rText(R(tp)!) : ''}` })
  if (sl) zones.push({ price: sl, fill: c.down, label: `SL  ${sl.toFixed(c.decimals)}` })
  if (!zones.length) zones.push({ price: exit, fill: won ? c.up : c.down, label: '' }) // no levels: the move itself

  const render = ({ context: g, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }: { context: CanvasRenderingContext2D; horizontalPixelRatio: number; verticalPixelRatio: number; bitmapSize: { width: number; height: number } }) => {
    const ts = chart.timeScale(), y = (p: number) => (series.priceToCoordinate(p) ?? NaN) * vr
    const xAt = (t: number) => (ts.timeToCoordinate(bar(t) as UTCTimestamp) ?? NaN) * hr
    const x1 = xAt(trade.mt5!.openTime), xe = xAt(end), e = y(entry), ye = y(exit)
    if ([x1, xe, e, ye].some(Number.isNaN)) return
    const half = Math.max(1, (ts.options().barSpacing * hr) / 2)
    const x2 = Math.max(xe, x1 + 170 * hr) // a readable tool even when the trade spans one bar; fills and the path keep the true times

    // When the trade was open, across the whole pane, so it stands out in a full day.
    g.globalAlpha = .07; g.fillStyle = c.ink
    g.fillRect(x1 - half, 0, Math.max(xe - x1 + 2 * half, 2 * hr), bitmapSize.height)

    for (const z of zones) {
      const zy = y(z.price), top = Math.min(e, zy), h = Math.abs(zy - e)
      g.globalAlpha = .18; g.fillStyle = z.fill; g.fillRect(x1, top, x2 - x1, h)
      g.globalAlpha = .9; g.fillRect(x1, Math.round(zy - vr / 2), x2 - x1, Math.max(1, Math.round(vr))) // level edge
    }
    g.globalAlpha = 1
    g.fillStyle = c.muted; g.fillRect(x1, Math.round(e - vr / 2), x2 - x1, Math.max(1, Math.round(vr))) // entry

    // Path through every fill, then a ringed dot per fill: buys in green, sells in red.
    const fills = trade.mt5!.deals.map(d => ({ x: xAt(d.time), y: y(d.price), buy: d.type === 0 }))
    g.strokeStyle = c.ink; g.globalAlpha = .55; g.lineWidth = 1.25 * hr; g.setLineDash([5 * hr, 4 * hr])
    g.beginPath(); g.moveTo(x1, e)
    for (const f of fills.slice(1)) g.lineTo(f.x, f.y)
    if (!trade.mt5!.closeTime) g.lineTo(xe, ye) // live: to the latest price
    g.stroke(); g.setLineDash([]); g.globalAlpha = 1
    for (const f of fills) {
      g.beginPath(); g.arc(f.x, f.y, 4.5 * hr, 0, Math.PI * 2); g.fillStyle = textOn(f.buy ? c.up : c.down) === '#ffffff' ? '#ffffff' : '#15171c'; g.fill()
      g.beginPath(); g.arc(f.x, f.y, 3.2 * hr, 0, Math.PI * 2); g.fillStyle = f.buy ? c.up : c.down; g.fill()
    }

    g.font = `600 ${11 * hr}px ${c.font}`; g.textBaseline = 'middle'
    const ph = 20 * vr, gap = 5 * vr
    const pill = (text: string, x: number, cy: number, fill: string, align: 'center' | 'beside') => {
      if (!text) return
      const w = g.measureText(text).width + 16 * hr
      const left = align === 'center' ? x - w / 2 : x + w + 8 * hr <= bitmapSize.width ? x + 8 * hr : x1 - 8 * hr - w // flips left of the box at the pane edge
      g.fillStyle = fill; g.beginPath(); if (g.roundRect) g.roundRect(left, cy - ph / 2, w, ph, ph / 2); else g.rect(left, cy - ph / 2, w, ph); g.fill() // older WebKitGTK has no roundRect
      g.fillStyle = textOn(fill); g.textAlign = 'center'; g.fillText(text, left + w / 2, cy + .5 * vr)
    }
    const mid = (x1 + x2) / 2
    for (const z of zones) { const zy = y(z.price); pill(z.label, mid, zy < e ? zy - gap - ph / 2 : zy + gap + ph / 2, z.fill, 'center') } // outside the zone
    pill(resultLabel, x2, ye, won ? c.up : c.down, 'beside') // beside the box, at the exit price
  }
  return { paneViews: () => [{ renderer: () => ({ draw: (target: any) => target.useBitmapCoordinateSpace(render) }) }] }
}
