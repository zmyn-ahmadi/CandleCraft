import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

async function load(entry) {
  const output = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}
const { readCandles, sma } = await load('src/replayData.ts')
const { blankWorkspace, validateWorkspace } = await load('src/model.ts')
const { aggregateCandles, availableTimeframes, barForPoint, ema, rsi } = await load('src/replayChartData.ts')

const samplePath = 'tests/fixtures/AMD_1d_data.csv'
const userPath = '/home/zee/Downloads/AMD_1d_data.csv'
test('AMD daily CSV imports in chronological order with volume', () => {
  const source = readFileSync(samplePath, 'utf8')
  const candles = readCandles(source)
  assert.equal(candles.length, 2)
  assert.deepEqual(candles.map(c => c.time.slice(0, 10)), ['2026-10-01', '2026-10-02'])
  assert.equal(candles[0].open, 612.7)
  assert.equal(candles[1].close, 636.78)
  assert.equal(candles[1].volume, 5732524)
})

test('supplied AMD file imports successfully', { skip: !existsSync(userPath) }, () => {
  const candles = readCandles(readFileSync(userPath, 'utf8'))
  assert.ok(candles.length >= 2)
  assert.ok(candles.every((c, i) => i === 0 || c.time > candles[i - 1].time))
})

test('AMD candles produce a visible chart with prices and dates', async () => {
  const output = await build({ entryPoints: ['src/ReplayChart.tsx'], bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports)
  const Chart = module.exports.default
  const candles = readCandles(readFileSync(samplePath, 'utf8'))
  const html = renderToStaticMarkup(React.createElement(Chart, { candles, drawings: [], onDrawingsChange: () => {}, symbol: 'AMD', timeframe: 'source', onTimeframeChange: () => {}, timeframes: availableTimeframes(candles) }))
  assert.match(html, /Revealed 1D chart for AMD/)
  assert.match(html, /636\.78/)
  assert.match(html, /1 Oct 26/)
  assert.match(html, /2 Oct 26/)
  assert.match(html, /TIMEFRAME/)
  assert.match(html, /Fibonacci retracement/)
  assert.match(html, /More bars needed to zoom in/)
  assert.match(html, /Needs 20 revealed bars/)
  const weekly = renderToStaticMarkup(React.createElement(Chart, { candles, drawings: [
    { id: 'level', type: 'horizontal', a: { index: 0, price: 620 } },
    { id: 'fib', type: 'fib', a: { index: 0, price: 610 }, b: { index: 1, price: 630 } },
  ], onDrawingsChange: () => {}, symbol: 'AMD', timeframe: '1W', onTimeframeChange: () => {}, timeframes: availableTimeframes(candles, 'AMD_1d_data.csv') }))
  assert.match(weekly, /Revealed 1W chart for AMD/)
  assert.match(weekly, /61\.8%/)
  assert.match(weekly, /2 drawings saved/)
  assert.match(weekly, /All revealed bars are visible/)
})

test('daily CSV offers daily, weekly and monthly buttons; aggregation preserves OHLCV', () => {
  const candles = readCandles(readFileSync(samplePath, 'utf8'))
  assert.deepEqual(availableTimeframes(candles, 'AMD_1d_data.csv').map(item => item.label), ['1D', '1W', '1M'])
  const weekly = aggregateCandles(candles, '1W')
  assert.equal(weekly.length, 1)
  assert.deepEqual(weekly[0], {
    candle: { time: candles[0].time, open: 612.7, high: 642.78, low: 601.5, close: 636.78, volume: 22816724 },
    startIndex: 0, endIndex: 1,
  })
  assert.equal(barForPoint(weekly, { index: 1, price: 620 }), 0)
  assert.equal(aggregateCandles(candles.slice(0, 1), '1W')[0].candle.close, 615.73)
})

test('intraday timeframes group in UTC without borrowing future candles', () => {
  const candles = readCandles('time,open,high,low,close,volume\n2026-10-01T00:00:00Z,10,11,9,10,1\n2026-10-01T00:01:00Z,10,12,10,11,2\n2026-10-01T00:05:00Z,11,13,11,12,3')
  assert.deepEqual(availableTimeframes(candles).slice(0, 3).map(item => item.label), ['1m','5m','15m'])
  const five = aggregateCandles(candles, '5m')
  assert.equal(five.length, 2)
  assert.deepEqual(five.map(bar => [bar.candle.open,bar.candle.high,bar.candle.low,bar.candle.close,bar.candle.volume]), [[10,12,9,11,3],[11,13,11,12,3]])
  assert.equal(aggregateCandles(candles.slice(0, 2), '5m').length, 1)
})

test('filename interval keeps sparse daily data on a daily chart', () => {
  const candles = readCandles('Date,Open,High,Low,Close\n2026-10-01,10,11,9,10\n2026-10-08,11,12,10,11')
  assert.deepEqual(availableTimeframes(candles, 'AMD_1d_data.csv').map(item => item.label), ['1D','1W','1M'])
  assert.deepEqual(availableTimeframes(candles, 'AMD_1h_data.csv').slice(0, 2).map(item => item.label), ['1h','4h'])
})

test('EMA and RSI wait for enough revealed bars', () => {
  const candles = Array.from({ length: 22 }, (_, i) => ({ time: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), open: i + 1, high: i + 2, low: i + 1, close: i + 1 }))
  assert.equal(ema(candles.slice(0, 19), 20).at(-1), null)
  assert.equal(ema(candles.slice(0, 20), 20).at(-1), 10.5)
  assert.equal(rsi(candles.slice(0, 14)).at(-1), null)
  assert.equal(rsi(candles.slice(0, 15)).at(-1), 100)
})

test('moving average uses only candles passed at the replay cursor', () => {
  const candles = readCandles('Date,Open,High,Low,Close\n2026-10-01,10,11,9,10\n2026-10-02,20,21,19,20\n2026-10-03,30,31,29,30')
  assert.deepEqual(sma(candles.slice(0, 2), 2), [null, 15])
  assert.deepEqual(sma(candles, 2), [null, 15, 25])
})

test('drawings and volume survive workspace validation', () => {
  const candles = readCandles(readFileSync(samplePath, 'utf8'))
  const workspace = { ...blankWorkspace(), replay: { id: 'amd', name: 'AMD_1d_data.csv', symbol: 'AMD', candles, cursor: 1, importedAt: new Date().toISOString(), timeframe: '1W', drawings: [{ id: 'line', type: 'fib', a: { index: 0, price: 610 }, b: { index: 1, price: 630 } }] } }
  assert.deepEqual(validateWorkspace(JSON.parse(JSON.stringify(workspace))).replay.drawings, workspace.replay.drawings)
  assert.equal(validateWorkspace(workspace).replay.timeframe, '1W')
  assert.throws(() => validateWorkspace({ ...workspace, replay: { ...workspace.replay, drawings: [{ ...workspace.replay.drawings[0], b: { index: 7, price: 630 } }] } }), /invalid replay drawings/)
})
