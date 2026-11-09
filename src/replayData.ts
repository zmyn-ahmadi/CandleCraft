import { parseCsv } from './csv'
import type { Candle, Trade } from './model'

export function readCandles(text: string): Candle[] {
  const rows = parseCsv(text)
  if (rows.length < 3) throw Error('Add a header and at least two candles')
  const headers = rows[0].map(x => x.toLowerCase().replace(/[^a-z]/g, ''))
  const column = (names: string[]) => headers.findIndex(x => names.includes(x))
  const indices = [column(['time', 'timestamp', 'datetime', 'date']), column(['open']), column(['high']), column(['low']), column(['close'])]
  const volumeIndex = column(['volume', 'vol'])
  if (indices.includes(-1)) throw Error('CSV needs time, open, high, low, and close columns')
  const candles = rows.slice(1).map((row, index) => {
    const rawTime = row[indices[0]]
    const namedDate = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})$/i.exec(rawTime)
    const month = namedDate ? ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(namedDate[1].toLowerCase()) : -1
    const time = namedDate ? new Date(Date.UTC(Number(namedDate[3]), month, Number(namedDate[2]))) : new Date(rawTime)
    const [open, high, low, close] = indices.slice(1).map(i => Number(row[i]?.replace(/,/g, '')))
    const volume = volumeIndex < 0 || !row[volumeIndex] ? undefined : Number(row[volumeIndex].replace(/,/g, ''))
    if (Number.isNaN(time.getTime()) || ![open, high, low, close].every(Number.isFinite) || [open, high, low, close].some(x => x <= 0) || low > Math.min(open, close) || high < Math.max(open, close) || low > high || (volume !== undefined && (!Number.isFinite(volume) || volume < 0))) throw Error(`Invalid OHLC data at row ${index + 2}`)
    return { time: time.toISOString(), open, high, low, close, ...(volume === undefined ? {} : { volume }) }
  })
  const descending = candles.length > 1 && candles[1].time < candles[0].time
  if (descending) candles.reverse()
  for (let i = 1; i < candles.length; i++) if (candles[i].time <= candles[i - 1].time) throw Error(`Timestamps must be consistently ordered without duplicates`)
  return candles
}

export function sma(candles: Candle[], period: number): (number | null)[] {
  let sum = 0
  return candles.map((candle, index) => {
    sum += candle.close
    if (index >= period) sum -= candles[index - period].close
    return index + 1 >= period ? sum / period : null
  })
}

export interface Fill { index: number; price: number; reason: 'stop' | 'target' }

/** Walk the candles after `from` until the stop or target is touched.
 *  A candle that touches both is treated as stopped out (OHLC cannot say which came first).
 *  A gap through the stop fills at that candle's open; a gap through the target fills at the target. */
export function simulateExit(candles: Candle[], from: number, direction: 'long' | 'short', stop: number, target: number): Fill | null {
  const long = direction === 'long'
  for (let index = from + 1; index < candles.length; index++) {
    const c = candles[index]
    if (long ? c.open <= stop : c.open >= stop) return { index, price: c.open, reason: 'stop' }
    if (long ? c.low <= stop : c.high >= stop) return { index, price: stop, reason: 'stop' }
    if (long ? c.high >= target : c.low <= target) return { index, price: target, reason: 'target' }
  }
  return null
}

/** Why a replay order cannot be placed, or null when stop, entry and target are in a valid order. */
export function replayOrderError(direction: 'long' | 'short', entry: number, stop: number, target: number, risk: number): string | null {
  if (![stop, target, risk].every(Number.isFinite) || risk <= 0) return 'Enter a stop, a target, and a risk amount above zero.'
  if (direction === 'long' ? !(stop < entry && entry < target) : !(target < entry && entry < stop)) return direction === 'long' ? 'For a long, the stop must be below the entry and the target above it.' : 'For a short, the stop must be above the entry and the target below it.'
  return null
}

export const replayRef = (datasetId: string, index: number) => `replay:${datasetId}:${index}`
const refIndex = (trade: Trade, datasetId: string) => trade.externalRef.startsWith(`replay:${datasetId}:`) ? Number(trade.externalRef.slice(`replay:${datasetId}:`.length)) : NaN

/** Close an open replay trade once the cursor reaches the candle where it exits. Gross = R × initial risk. */
export function settleReplayTrade(trade: Trade, candles: Candle[], datasetId: string, cursor: number): Partial<Trade> | null {
  const from = refIndex(trade, datasetId)
  if (trade.status !== 'open' || !Number.isInteger(from) || trade.entryPrice == null || trade.initialStop == null || trade.target == null || trade.initialRisk == null) return null
  const fill = simulateExit(candles, from, trade.direction, trade.initialStop, trade.target)
  if (!fill || fill.index > cursor) return null
  const r = (trade.direction === 'long' ? fill.price - trade.entryPrice : trade.entryPrice - fill.price) / Math.abs(trade.entryPrice - trade.initialStop)
  return { status: 'closed', exitPrice: fill.price, exitedAt: candles[fill.index].time.slice(0, 10), gross: Math.round(r * trade.initialRisk * 100) / 100, exitReason: fill.reason, updatedAt: new Date().toISOString() }
}
