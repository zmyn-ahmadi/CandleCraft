import { parseCsv } from './csv'
import type { Candle } from './model'

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
