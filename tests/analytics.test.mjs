import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const output = await build({ entryPoints: ['src/analytics.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
const { analyticsSeries, filterTrades } = await import(moduleUrl)

const modelOutput = await build({ entryPoints: ['src/model.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const modelUrl = `data:text/javascript;base64,${Buffer.from(modelOutput.outputFiles[0].text).toString('base64')}`
const { blankWorkspace, metrics, outcome, validateWorkspace } = await import(modelUrl)

const baseTrade = (patch = {}) => ({
  id: 'one', accountId: 'primary', environment: 'demo', status: 'closed', symbol: 'EURUSD',
  direction: 'long', strategyId: 'strategy', strategyVersion: 1, enteredAt: '2025-01-01', exitedAt: '2025-01-02',
  entryPrice: null, exitPrice: null, size: null, initialStop: null, target: null, initialRisk: 50,
  gross: 100, fees: -5, swap: 0, externalRef: '', source: 'manual', reason: '', notes: '', lesson: '', tags: [],
  checklist: { required: 'yes' }, createdAt: '2025-01-01', updatedAt: '2025-01-01', ...patch,
})
const strategy = { id: 'strategy', name: 'Plan', archived: false, versions: [{ number: 1, checklist: [{ id: 'required', text: 'Followed plan', required: true }] }] }

test('analytics uses net costs, excludes open trades, and handles missing risk', () => {
  const trades = [
    baseTrade(),
    baseTrade({ id: 'two', exitedAt: '2025-01-03', gross: -50, fees: -2, checklist: { required: 'no' } }),
    baseTrade({ id: 'three', exitedAt: '2025-01-04', gross: 0, fees: 0, initialRisk: null, checklist: {} }),
    baseTrade({ id: 'open', status: 'open', gross: 1000 }),
  ]
  const result = metrics(trades, [strategy])
  assert.equal(result.closed, 3)
  assert.equal(result.net, 43)
  assert.equal(result.wins, 1)
  assert.equal(result.winRate, 1 / 3)
  assert.ok(Math.abs(result.netR - 0.86) < 1e-10)
  assert.ok(Math.abs(result.expectancy - 0.43) < 1e-10)
  assert.equal(result.missingR, 1)
  assert.equal(result.drawdown, 52)
  assert.equal(result.longestStreak, 1)
  assert.equal(result.adherence, 0.5)
  assert.ok(Math.abs(result.profitFactor - 95 / 52) < 1e-10)
})

test('outcome bars and equity curve share the same cent rounding', () => {
  assert.equal(outcome(0.004), 'breakeven')
  assert.equal(outcome(0.005), 'win')
  assert.equal(outcome(-0.005), 'loss')
  assert.equal(outcome(0.49, 0), 'breakeven')
  assert.equal(outcome(0.5, 0), 'win')
  const trades = [
    baseTrade({ id: 'later', exitedAt: '2025-02-02', gross: -10, fees: 0, initialRisk: 10 }),
    baseTrade({ id: 'earlier', exitedAt: '2025-02-01', gross: 20, fees: 0, initialRisk: 10 }),
  ]
  const { curve, counts } = analyticsSeries(trades)
  assert.deepEqual(curve.map(point => point.trade.id), ['earlier', 'later'])
  assert.deepEqual(curve.map(point => point.balance), [20, 10])
  assert.deepEqual(curve.map(point => point.r), [2, 1])
  assert.deepEqual(counts, { win: 1, loss: 1, breakeven: 0 })
})

test('date, pair, strategy and direction filters apply to chart inputs', () => {
  const trades = [
    baseTrade({ id: 'inside', symbol: 'AUDUSD', direction: 'short', exitedAt: '2025-02-02T12:00:00Z' }),
    baseTrade({ id: 'outside', symbol: 'EURUSD', exitedAt: '2025-02-03' }),
  ]
  const result = filterTrades(trades, { from: '2025-02-02', to: '2025-02-02', symbol: 'AUDUSD', strategyId: 'strategy', direction: 'short' })
  assert.deepEqual(result.map(trade => trade.id), ['inside'])
})

test('damaged trade and replay data are rejected before restore', () => {
  const valid = blankWorkspace()
  assert.equal(validateWorkspace(valid).schemaVersion, 1)
  assert.throws(() => validateWorkspace({ ...valid, trades: [baseTrade({ fees: 'five' })] }), /invalid trades/)
  assert.throws(() => validateWorkspace({ ...valid, replay: { cursor: 9, candles: [{ time: '2025-01-01', open: 1, high: 2, low: 0, close: 1 }] } }), /invalid replay/)
})
