import type { Candle, ReplayPoint } from './model'

export type Timeframe = 'source' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M'
export interface ChartBar { candle: Candle; startIndex: number; endIndex: number }
const fixedMs: Partial<Record<Timeframe, number>> = { '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '4h': 14400000, '1D': 86400000 }
const ordered: Timeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M']

export function sourceLabel(candles: Candle[], filename = ''): string {
  const hint = /(?:^|[_-])(1m|5m|15m|30m|1h|4h|1d|1w|1mo)(?=[_.-])/i.exec(filename)?.[1]?.toLowerCase()
  if (hint) return hint === '1mo' ? '1M' : hint.endsWith('d') || hint.endsWith('w') ? hint.toUpperCase() : hint
  if (candles.length < 2) return 'Source'
  const gaps = candles.slice(1).map((candle, i) => Date.parse(candle.time) - Date.parse(candles[i].time)).filter(gap => gap > 0).sort((a, b) => a - b)
  const gap = gaps[0]
  if (!gap) return 'Source'
  if (gap >= 20 * 86400000) return '1M'
  if (gap >= 6 * 86400000) return '1W'
  if (gap >= 86400000) return '1D'
  if (gap >= 14400000) return '4h'
  if (gap >= 3600000) return '1h'
  if (gap >= 1800000) return '30m'
  if (gap >= 900000) return '15m'
  if (gap >= 300000) return '5m'
  if (gap >= 60000) return '1m'
  return 'Source'
}

export function availableTimeframes(candles: Candle[], filename = ''): { value: Timeframe; label: string }[] {
  const label = sourceLabel(candles, filename)
  const sourcePosition = ordered.indexOf(label as Timeframe)
  return [{ value: 'source', label }, ...ordered.slice(sourcePosition < 0 ? 0 : sourcePosition + 1).map(value => ({ value, label: value }))]
}

function bucket(time: string, timeframe: Timeframe): string {
  const date = new Date(time)
  if (timeframe === '1M') return `${date.getUTCFullYear()}-${date.getUTCMonth()}`
  if (timeframe === '1W') {
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7)
    return monday.toISOString().slice(0, 10)
  }
  return String(Math.floor(date.getTime() / fixedMs[timeframe]!))
}

export function aggregateCandles(candles: Candle[], timeframe: Timeframe): ChartBar[] {
  if (timeframe === 'source') return candles.map((candle, index) => ({ candle, startIndex: index, endIndex: index }))
  const result: ChartBar[] = []
  for (let index = 0; index < candles.length; index++) {
    const candle = candles[index]
    const key = bucket(candle.time, timeframe)
    const previous = result.at(-1)
    if (previous && bucket(previous.candle.time, timeframe) === key) {
      previous.candle.high = Math.max(previous.candle.high, candle.high)
      previous.candle.low = Math.min(previous.candle.low, candle.low)
      previous.candle.close = candle.close
      if (previous.candle.volume !== undefined || candle.volume !== undefined) previous.candle.volume = (previous.candle.volume || 0) + (candle.volume || 0)
      previous.endIndex = index
    } else result.push({ candle: { ...candle }, startIndex: index, endIndex: index })
  }
  return result
}

export function barForPoint(bars: ChartBar[], point: ReplayPoint): number {
  return bars.findIndex(bar => point.index >= bar.startIndex && point.index <= bar.endIndex)
}

export function ema(candles: Candle[], period: number): (number | null)[] {
  const multiplier = 2 / (period + 1)
  let seed = 0, previous = 0
  return candles.map((candle, index) => {
    if (index < period) seed += candle.close
    if (index === period - 1) previous = seed / period
    else if (index >= period) previous = candle.close * multiplier + previous * (1 - multiplier)
    return index < period - 1 ? null : previous
  })
}

export function rsi(candles: Candle[], period = 14): (number | null)[] {
  let gains = 0, losses = 0
  return candles.map((candle, index) => {
    if (index === 0) return null
    const change = candle.close - candles[index - 1].close
    const gain = Math.max(0, change), loss = Math.max(0, -change)
    if (index <= period) { gains += gain; losses += loss }
    else { gains = (gains * (period - 1) + gain) / period; losses = (losses * (period - 1) + loss) / period }
    if (index < period) return null
    if (index === period) { gains /= period; losses /= period }
    return losses === 0 ? gains === 0 ? 50 : 100 : 100 - 100 / (1 + gains / losses)
  })
}
