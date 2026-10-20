import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const load = async path => {
  const output = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}
const { calculateRiskNotebook } = await load('src/risk.ts')
const { blankWorkspace, defaultRiskNotebook, prepareWorkspace, validateWorkspace, net } = await load('src/model.ts')
const { guessColumns, importTrade, parseCsv } = await load('src/csv.ts')

test('standalone notebook calculates position size and reward:risk from entered values', () => {
  const note = { ...defaultRiskNotebook(), balance: 1000, entry: 100, stop: 98, target: 104, valuePerPriceUnit: 1, estimatedFees: 2 }
  const result = calculateRiskNotebook(note)
  assert.equal(result.riskCapital, 10)
  assert.equal(result.stopDistance, 2)
  assert.equal(result.size, 5)
  assert.equal(result.rewardRisk, 2)
  assert.equal(result.netAtTarget, 18)
  assert.equal(calculateRiskNotebook({ ...note, direction: 'short', stop: 102, target: 96 }).size, 5)
  assert.equal(calculateRiskNotebook({ ...note, stop: 102 }).size, null)
})

test('manual daily, weekly, drawdown and streak inputs produce advisory calculations', () => {
  const note = { ...defaultRiskNotebook(), balance: 945, dailyStart: 1000, dailyPnl: -25, weeklyPeak: 1000, accountPeak: 1100, consecutiveStopLosses: 3, lastStopAt: '2026-10-04T10:00' }
  const result = calculateRiskNotebook(note, new Date('2026-10-04T12:00:00Z'))
  assert.equal(result.dailyBudget, 20)
  assert.equal(result.dailyRemaining, 0)
  assert.equal(result.reducedRisk, true)
  assert.equal(result.suggestedRisk, 4.725)
  assert.equal(calculateRiskNotebook({ ...note, entry: 100, stop: 99, target: 102, valuePerPriceUnit: 1 }).size, 4.725)
  assert.ok(result.currentDrawdown > 10)
  assert.ok(result.alerts.some(alert => alert.includes('Daily')))
  assert.ok(result.alerts.some(alert => alert.includes('Maximum')))
})

test('manual review computes expectancy, profit factor and discipline', () => {
  const note = { ...defaultRiskNotebook(), wins: 12, losses: 8, averageWin: 20, averageLoss: 10, grossProfit: 240, grossLoss: 80, followedPlan: 19, reviewedTrades: 20, equityHistory: '1000,980,1020,900' }
  const result = calculateRiskNotebook(note)
  assert.equal(result.sample, 20)
  assert.equal(result.expectancy, 8)
  assert.equal(result.profitFactor, 3)
  assert.equal(result.discipline, 0.95)
  assert.ok(Math.abs(result.maxDrawdown - 120 / 1020 * 100) < 1e-8)
  assert.equal(result.maxDrawdownCash, 120)
})

test('risk notebook persists independently of trade records and migrates old thresholds', () => {
  const note = { ...defaultRiskNotebook(), balance: 1000, entryRules: 'Wait for a retest', reviewNotes: 'Reduce size after drawdown' }
  const workspace = { ...blankWorkspace(), trades: [], riskNotebook: note }
  assert.deepEqual(validateWorkspace(structuredClone(workspace)).riskNotebook, note)
  assert.equal(prepareWorkspace(workspace).riskNotebook.entryRules, 'Wait for a retest')
  assert.throws(() => validateWorkspace({ ...workspace, riskNotebook: { ...note, balance: -1 } }), /invalid risk notebook/)
  const legacy = { ...workspace, riskNotebook: undefined, riskProfiles: { 'demo:primary': { startingBalance: 1000, perTradePct: 0.75, minRewardRisk: 2, dailyLossPct: 2, weeklyDrawdownPct: 5, maxDrawdownPct: 10, reducedRiskPct: 0.5, lossStreakLimit: 3, cooldownHours: 24 } } }
  assert.equal(prepareWorkspace(legacy).riskNotebook.perTradePct, 0.75)
  assert.equal(prepareWorkspace(legacy).riskNotebook.balance, null)
})

test('CSV cost and optional legacy fields remain readable without the notebook', () => {
  const rows = parseCsv('symbol,direction,entry date,profit,fees,spread,swap,initial risk,entry price,exit price,stop loss,target,balance before,point value,setup,rule adherence,exit reason\nAMD,buy,2026-10-01,20,-1,-2,-1,10,100,102,99,103,1000,1,Pullback,yes,target')
  const columns = guessColumns(rows[0])
  const gross = importTrade(rows[1], columns, 'primary', 'demo', false)
  assert.equal(net(gross), 16)
  assert.equal(gross.initialStop, 99)
  const alreadyNet = importTrade(rows[1], columns, 'primary', 'demo', true)
  assert.equal(net(alreadyNet), 20)
})
