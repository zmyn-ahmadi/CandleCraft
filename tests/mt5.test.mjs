import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const load = async path => {
  const output = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}
const { mergeMt5, chartWindow, DAY } = await load('src/mt5.ts')
const { blankWorkspace, validateWorkspace } = await load('src/model.ts')

// Same fixture as skills/candlecraft-mt5-sync/scripts/sync.py --self-test, so the app and the skill stay in step.
const IN = 0, OUT = 1, BUY = 0, SELL = 1
const deal = (pos, entry, type, t, price, vol = 1, profit = 0, comm = -3.5, reason = 0, order = 0) =>
  ({ position_id: pos, entry, type, time: t, time_msc: t * 1000, price, volume: vol, profit, commission: comm, swap: 0, fee: 0, reason, symbol: 'XAUUSD.r', order })
const d1 = 1_761_609_600, d2 = 1_761_696_000 // 2025-10-28, 2025-10-29 00:00 server time
const snapshot = {
  account: { currency: 'AUD', trade_mode: 2 },
  deals: [
    { position_id: 0, type: 2, entry: 0, time: d1, time_msc: d1 * 1000 },
    deal(1, IN, BUY, d1 + 60, 2000, 1, 0, -3.5, 0, 11),
    deal(1, OUT, SELL, d1 + 120, 2010, 0.5, 5, -3.5, 5),
    deal(1, OUT, SELL, d2 + 60, 2020, 0.5, 10, -3.5, 4),
    deal(2, IN, SELL, d2 + 300, 1.1, 0.2),
    deal(3, OUT, BUY, d1 - 86_400, 1.0), // opened before the history window
  ],
  orders: [{ ticket: 11, sl: 1990, tp: 0 }],
  positions: [{ ticket: 2, identifier: 2 }],
}

test('MT5 positions become trades with the sync skill field mapping', () => {
  const { workspace, added, changed, environment, accountId } = mergeMt5(blankWorkspace(), snapshot, 'primary')
  assert.equal(environment, 'live'); assert.equal(accountId, 'primary'); assert.equal(added, 2); assert.equal(changed, 2)
  const [closed, open] = workspace.trades
  assert.deepEqual(
    { symbol: closed.symbol, direction: closed.direction, status: closed.status, enteredAt: closed.enteredAt, exitedAt: closed.exitedAt, entryPrice: closed.entryPrice, exitPrice: closed.exitPrice, size: closed.size, initialStop: closed.initialStop, target: closed.target, gross: closed.gross, fees: closed.fees, exitReason: closed.exitReason, externalRef: closed.externalRef },
    { symbol: 'XAUUSD', direction: 'long', status: 'closed', enteredAt: '2025-10-28', exitedAt: '2025-10-29', entryPrice: 2000, exitPrice: 2015, size: 1, initialStop: 1990, target: null, gross: 15, fees: -10.5, exitReason: 'trailing', externalRef: 'mt5:1' })
  assert.deepEqual(closed.mt5, { position: 1, symbol: 'XAUUSD.r', openTime: d1 + 60, closeTime: d2 + 60, deals: [{ time: d1 + 60, price: 2000, type: 0 }, { time: d1 + 120, price: 2010, type: 1 }, { time: d2 + 60, price: 2020, type: 1 }] })
  assert.equal(open.status, 'open'); assert.equal(open.direction, 'short'); assert.equal(open.gross, null); assert.equal(open.mt5.closeTime, null)
  validateWorkspace(workspace)
})

test('re-syncing keeps journal work and changes nothing when MT5 has nothing new', () => {
  const first = mergeMt5(blankWorkspace(), snapshot, 'primary').workspace
  const journaled = { ...first, trades: first.trades.map(t => ({ ...t, reason: 'Range break', strategyId: 's1', initialRisk: 20, tags: ['clean'] })) }
  const again = mergeMt5(journaled, snapshot, 'primary')
  assert.equal(again.changed, 0); assert.equal(again.workspace, journaled)
  const closedLater = mergeMt5(journaled, { ...snapshot, deals: [...snapshot.deals, deal(2, OUT, BUY, d2 + 900, 1.09, 0.2, 2, 0, 5)], positions: [] }, 'primary')
  const trade = closedLater.workspace.trades.find(t => t.externalRef === 'mt5:2')
  assert.equal(closedLater.changed, 1); assert.equal(trade.status, 'closed'); assert.equal(trade.target, 1.09); assert.equal(trade.exitReason, 'target')
  assert.equal(trade.reason, 'Range break'); assert.equal(trade.initialRisk, 20); assert.deepEqual(trade.tags, ['clean']); assert.equal(trade.id, journaled.trades[1].id)
})

test('chart window covers each server day the trade touches and is cacheable once the last day ends', () => {
  const link = { position: 1, symbol: 'X', openTime: d1 + 3600, closeTime: d2 + 60, deals: [] }
  assert.deepEqual(chartWindow(link, d2 + 100), { start: d1, end: d2 + DAY, complete: false })
  assert.equal(chartWindow(link, d2 + DAY + 1).complete, true)
  assert.equal(chartWindow({ ...link, closeTime: null }, d2 + 100).complete, false)
})
