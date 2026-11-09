import { blankWorkspace, defaultRiskNotebook, type Assessment, type Candle, type Trade, type Workspace } from './model'

// Invented sample data for the public web demo. Never bundled into the desktop app.
const ACCOUNT = 'sample-aud'
const STRATEGY = 'sample-breakout'
const CHECKLIST = [
  { id: 'trend', text: 'Higher timeframe trend agrees', required: true },
  { id: 'level', text: 'Entry is at a marked level', required: true },
  { id: 'news', text: 'No high impact news within 30 minutes', required: false },
]
const SYMBOLS = [['EURUSD', 1.08, 0.004], ['GBPUSD', 1.27, 0.005], ['AUDUSD', 0.66, 0.003], ['XAUUSD', 2650, 12]] as const
const OUTCOMES = [2, -1, 1.5, -1, 2.4, 0.6, -1, 2, -0.5, 1.8, -1, 2.2, -1, -1, 3, 1, -1, 2, 0.8, -1, 1.6, 2.5, -1, 1.2, -0.4, 2, -1, 1.5, 2.1, -1]

function sampleTrade(result: number, i: number): Trade {
  const [symbol, base, stopDistance] = SYMBOLS[i % SYMBOLS.length]
  const direction = i % 3 === 0 ? 'short' : 'long'
  const side = direction === 'long' ? 1 : -1
  const entered = new Date(Date.UTC(2026, 6, 6 + i * 3, 8 + i % 8, 30))
  const exited = new Date(entered.getTime() + (2 + i % 5) * 3600000)
  const entryPrice = +(base * (1 + (i % 7) / 400)).toFixed(4)
  const followed: Assessment = i % 6 === 5 ? 'no' : 'yes'
  return {
    id: `sample-${i}`, accountId: ACCOUNT, environment: 'demo', status: 'closed', symbol, direction,
    strategyId: STRATEGY, strategyVersion: 1, enteredAt: entered.toISOString(), exitedAt: exited.toISOString(),
    entryPrice, exitPrice: +(entryPrice + side * stopDistance * result).toFixed(4), size: 0.5,
    initialStop: +(entryPrice - side * stopDistance).toFixed(4), target: +(entryPrice + side * stopDistance * 2).toFixed(4),
    initialRisk: 100, gross: result * 100 + 4, fees: -3, swap: -1, externalRef: '', source: 'manual',
    reason: 'Sample trade: retest of the marked level with the higher timeframe trend.',
    notes: '', lesson: result < 0 ? 'Sample note: wait for the close before entering.' : '', tags: ['sample'],
    checklist: { trend: 'yes', level: followed, news: 'unassessed' }, ruleAdherence: followed,
    exitReason: result >= 2 ? 'target' : result <= -1 ? 'stop' : 'manual',
    createdAt: entered.toISOString(), updatedAt: exited.toISOString(),
  }
}

function sampleCandles(): Candle[] {
  let close = 1.08
  return Array.from({ length: 400 }, (_, i) => {
    const open = close
    close = +(open + Math.sin(i / 11) * 0.0012 + Math.sin(i * 7.3) * 0.0009).toFixed(5)
    const wick = 0.0004 + Math.abs(Math.sin(i * 3.1)) * 0.0006
    return { time: new Date(Date.UTC(2026, 8, 1, i)).toISOString(), open, high: +(Math.max(open, close) + wick).toFixed(5), low: +(Math.min(open, close) - wick).toFixed(5), close, volume: 800 + (i * 37) % 900 }
  })
}

export function demoWorkspace(): Workspace {
  return {
    ...blankWorkspace(),
    accounts: [{ id: ACCOUNT, name: 'Sample account', currency: 'AUD' }],
    activeScope: { environment: 'demo', accountId: ACCOUNT },
    strategies: [{
      id: STRATEGY, name: 'Sample London breakout', archived: false,
      versions: [{ number: 1, createdAt: '2026-07-01', description: 'Example rulebook for the demo.', instruments: 'FX majors, gold', setupTimeframe: '1h', entryTimeframe: '5m', session: 'London', timezone: 'UTC', setup: 'Range forms before the session opens.', trigger: 'Close beyond the range, then a retest.', stop: 'Beyond the retest.', target: '2R', sizing: '1% risk', exposure: 'One open trade', skip: 'High impact news.', checklist: CHECKLIST }],
    }],
    trades: OUTCOMES.map(sampleTrade),
    reviews: [{ id: 'sample-review', date: '2026-08-02', environment: 'demo', accountId: ACCOUNT, from: '2026-07-06', to: '2026-08-02', snapshot: { trades: 9, net: 480, netR: 4.8, adherence: 0.89 }, worked: 'Sample review: waiting for the retest.', problems: 'Two early entries.', action: 'Keep the checklist open while the session runs.' }],
    riskNotebook: { ...defaultRiskNotebook(), balance: 10000, entry: 1.085, stop: 1.081, target: 1.093, valuePerPriceUnit: 100000 },
    replay: { id: 'sample-replay', name: 'Sample EURUSD 1h', symbol: 'EURUSD', candles: sampleCandles(), cursor: 180, importedAt: '2026-09-20T00:00:00.000Z', timeframe: 'source' },
  }
}
