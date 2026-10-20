import { validateCanvasCollections, type CanvasCollection } from './canvasModel'

export type Environment = 'live' | 'demo' | 'backtest'
export type TradeStatus = 'draft' | 'planned' | 'open' | 'closed' | 'cancelled'
export type Direction = 'long' | 'short'
export type Assessment = 'yes' | 'no' | 'unassessed'
export type Wallpaper = 'graphite' | 'dusk' | 'coast' | 'custom'

export interface Account { id: string; name: string; currency: string }
export interface StrategyVersion {
  number: number; createdAt: string; description: string; instruments: string; setupTimeframe: string;
  entryTimeframe: string; session: string; timezone: string; setup: string; trigger: string;
  stop: string; target: string; sizing: string; exposure: string; skip: string;
  checklist: { id: string; text: string; required: boolean }[]
}
export interface Strategy { id: string; name: string; archived: boolean; versions: StrategyVersion[] }
export interface Trade {
  id: string; accountId: string; environment: Environment; status: TradeStatus; symbol: string;
  direction: Direction; strategyId: string; strategyVersion: number | null; enteredAt: string;
  exitedAt: string; entryPrice: number | null; exitPrice: number | null; size: number | null;
  initialStop: number | null; target: number | null; initialRisk: number | null;
  gross: number | null; fees: number; swap: number; externalRef: string; source: 'manual' | 'csv' | 'replay';
  reason: string; notes: string; lesson: string; tags: string[]; checklist: Record<string, Assessment>;
  evidence?: { before?: string; after?: string };
  balanceBefore?: number | null; valuePerPriceUnit?: number | null; spread?: number;
  setupTag?: string; ruleAdherence?: Assessment; exitReason?: 'target' | 'stop' | 'manual' | 'trailing' | 'other' | '';
  createdAt: string; updatedAt: string
}
export interface RiskProfile { startingBalance: number | null; perTradePct: number; minRewardRisk: number; dailyLossPct: number; weeklyDrawdownPct: number; maxDrawdownPct: number; reducedRiskPct: number; lossStreakLimit: number; cooldownHours: number; reviewedDrawdownAt?: string; drawdownReviewNote?: string }
export interface RiskNotebook {
  balance: number | null; perTradePct: number; minRewardRisk: number; dailyLossPct: number; weeklyDrawdownPct: number; maxDrawdownPct: number; reducedRiskPct: number; lossStreakLimit: number; cooldownHours: number;
  direction: Direction; entry: number | null; stop: number | null; target: number | null; valuePerPriceUnit: number | null; estimatedFees: number;
  dailyStart: number | null; dailyPnl: number | null; weeklyPeak: number | null; accountPeak: number | null; consecutiveStopLosses: number; lastStopAt: string;
  wins: number | null; losses: number | null; averageWin: number | null; averageLoss: number | null; grossProfit: number | null; grossLoss: number | null; followedPlan: number | null; reviewedTrades: number | null;
  entryRules: string; stopRules: string; exitRules: string; resetRules: string; reviewNotes: string; equityHistory: string;
}
export const defaultRiskNotebook = (): RiskNotebook => ({ balance: null, perTradePct: 1, minRewardRisk: 2, dailyLossPct: 2, weeklyDrawdownPct: 5, maxDrawdownPct: 10, reducedRiskPct: 0.5, lossStreakLimit: 3, cooldownHours: 24, direction: 'long', entry: null, stop: null, target: null, valuePerPriceUnit: 1, estimatedFees: 0, dailyStart: null, dailyPnl: null, weeklyPeak: null, accountPeak: null, consecutiveStopLosses: 0, lastStopAt: '', wins: null, losses: null, averageWin: null, averageLoss: null, grossProfit: null, grossLoss: null, followedPlan: null, reviewedTrades: null, entryRules: '', stopRules: '', exitRules: '', resetRules: '', reviewNotes: '', equityHistory: '' })
export interface Review { id: string; date: string; environment: Environment; accountId?: string; from: string; to: string;
  snapshot: { trades: number; net: number; netR: number | null; adherence: number | null };
  worked: string; problems: string; action: string }
export interface Candle { time: string; open: number; high: number; low: number; close: number; volume?: number }
export interface ReplayPoint { index: number; price: number }
export interface ReplayDrawing { id: string; type: 'trend' | 'ray' | 'horizontal' | 'vertical' | 'rectangle' | 'fib' | 'measure'; a: ReplayPoint; b?: ReplayPoint }
export interface ReplayDataset { id: string; name: string; symbol: string; candles: Candle[]; cursor: number; importedAt: string; drawings?: ReplayDrawing[]; timeframe?: 'source' | '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1D' | '1W' | '1M' }
export interface Workspace { activeScope?: { environment: Environment; accountId: string }; schemaVersion: 1; accounts: Account[]; strategies: Strategy[]; trades: Trade[]; reviews: Review[]; timezone: string; theme: 'light' | 'dark'; wallpaper?: Wallpaper; customWallpaper?: string; appearanceVersion?: 2; replay?: ReplayDataset; riskProfiles?: Record<string, RiskProfile>; riskNotebook?: RiskNotebook; canvasCollections?: CanvasCollection[] }

export function validateWorkspace(value: unknown): Workspace {
  const data = value as Workspace
  const record = (item: unknown): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  const finiteOrNull = (item: unknown) => item === null || (typeof item === 'number' && Number.isFinite(item))
  if (!record(data) || data.schemaVersion !== 1 || !Array.isArray(data.accounts) || !Array.isArray(data.strategies) || !Array.isArray(data.trades) || !Array.isArray(data.reviews)) throw Error('Invalid or unsupported workspace file')
  if (!data.accounts.every(account => record(account) && typeof account.id === 'string' && typeof account.name === 'string' && typeof account.currency === 'string' && /^[A-Z]{3}$/.test(account.currency))) throw Error('Workspace has invalid accounts')
  if (!data.strategies.every(strategy => record(strategy) && typeof strategy.id === 'string' && typeof strategy.name === 'string' && Array.isArray(strategy.versions) && strategy.versions.length > 0 && strategy.versions.every(version => record(version) && typeof version.number === 'number' && Array.isArray(version.checklist)))) throw Error('Workspace has invalid strategies')
  if (!data.trades.every(trade => record(trade) && typeof trade.id === 'string' && typeof trade.accountId === 'string' && typeof trade.symbol === 'string' && typeof trade.enteredAt === 'string' && typeof trade.exitedAt === 'string' && ['draft','planned','open','closed','cancelled'].includes(trade.status) && ['live','demo','backtest'].includes(trade.environment) && ['long','short'].includes(trade.direction) && finiteOrNull(trade.gross) && finiteOrNull(trade.initialRisk) && typeof trade.fees === 'number' && Number.isFinite(trade.fees) && typeof trade.swap === 'number' && Number.isFinite(trade.swap) && Array.isArray(trade.tags) && record(trade.checklist))) throw Error('Workspace has invalid trades')
  if (!data.trades.every(trade => (['balanceBefore','valuePerPriceUnit'] as const).every(key => trade[key] === undefined || (finiteOrNull(trade[key]) && (trade[key] === null || (trade[key] as number) > 0))) && (trade.spread === undefined || typeof trade.spread === 'number' && Number.isFinite(trade.spread)) && (trade.setupTag === undefined || typeof trade.setupTag === 'string') && (trade.ruleAdherence === undefined || ['yes','no','unassessed'].includes(trade.ruleAdherence as string)) && (trade.exitReason === undefined || ['','target','stop','manual','trailing','other'].includes(trade.exitReason as string)))) throw Error('Workspace has invalid risk fields')
  if (data.riskProfiles !== undefined && (!record(data.riskProfiles) || !Object.values(data.riskProfiles).every(profile => record(profile) && finiteOrNull(profile.startingBalance) && (profile.startingBalance === null || (profile.startingBalance as number) > 0) && ['perTradePct','minRewardRisk','dailyLossPct','weeklyDrawdownPct','maxDrawdownPct','reducedRiskPct','cooldownHours'].every(key => typeof profile[key] === 'number' && Number.isFinite(profile[key]) && (profile[key] as number) > 0) && Number.isInteger(profile.lossStreakLimit) && (profile.lossStreakLimit as number) > 0 && (profile.reviewedDrawdownAt === undefined || typeof profile.reviewedDrawdownAt === 'string') && (profile.drawdownReviewNote === undefined || typeof profile.drawdownReviewNote === 'string')))) throw Error('Workspace has invalid risk profile')
  if (data.riskNotebook !== undefined) {
    const note = data.riskNotebook
    const positiveOrNull = (item: unknown) => item === null || (typeof item === 'number' && Number.isFinite(item) && item > 0)
    const nonnegativeOrNull = (item: unknown) => item === null || (typeof item === 'number' && Number.isFinite(item) && item >= 0)
    if (!record(note) || !['balance','entry','stop','target','valuePerPriceUnit','dailyStart','weeklyPeak','accountPeak'].every(key => positiveOrNull(note[key])) || !finiteOrNull(note.dailyPnl) || !['wins','losses','averageWin','averageLoss','grossProfit','grossLoss','followedPlan','reviewedTrades'].every(key => nonnegativeOrNull(note[key])) || !['wins','losses','followedPlan','reviewedTrades'].every(key => note[key] === null || Number.isInteger(note[key])) || !['perTradePct','minRewardRisk','dailyLossPct','weeklyDrawdownPct','maxDrawdownPct','reducedRiskPct','cooldownHours'].every(key => typeof note[key] === 'number' && Number.isFinite(note[key]) && (note[key] as number) > 0) || !Number.isInteger(note.lossStreakLimit) || (note.lossStreakLimit as number) < 1 || !Number.isInteger(note.consecutiveStopLosses) || (note.consecutiveStopLosses as number) < 0 || typeof note.estimatedFees !== 'number' || !Number.isFinite(note.estimatedFees) || note.estimatedFees < 0 || !['long','short'].includes(note.direction as string) || !['lastStopAt','entryRules','stopRules','exitRules','resetRules','reviewNotes','equityHistory'].every(key => typeof note[key] === 'string')) throw Error('Workspace has invalid risk notebook')
  }
  if (data.canvasCollections !== undefined && !validateCanvasCollections(data.canvasCollections)) throw Error('Workspace has invalid canvas collections')
  if (!data.reviews.every(review => record(review) && typeof review.id === 'string' && typeof review.date === 'string' && typeof review.from === 'string' && typeof review.to === 'string' && record(review.snapshot) && typeof review.snapshot.trades === 'number' && typeof review.snapshot.net === 'number' && finiteOrNull(review.snapshot.netR) && finiteOrNull(review.snapshot.adherence))) throw Error('Workspace has invalid reviews')
  if (data.replay !== undefined) {
    const replay = data.replay
    if (!record(replay) || !Array.isArray(replay.candles) || !Number.isInteger(replay.cursor) || replay.cursor < 0 || replay.cursor >= replay.candles.length) throw Error('Workspace has invalid replay data')
    if (!replay.candles.every(candle => record(candle) && typeof candle.time === 'string' && ['open','high','low','close'].every(key => typeof candle[key] === 'number' && Number.isFinite(candle[key])) && (candle.volume === undefined || (typeof candle.volume === 'number' && Number.isFinite(candle.volume) && candle.volume >= 0)))) throw Error('Workspace has invalid replay candles')
    const validPoint = (point: unknown) => record(point) && Number.isInteger(point.index) && (point.index as number) >= 0 && (point.index as number) < replay.candles.length && typeof point.price === 'number' && Number.isFinite(point.price)
    if (replay.timeframe !== undefined && !['source','1m','5m','15m','30m','1h','4h','1D','1W','1M'].includes(replay.timeframe)) throw Error('Workspace has invalid replay timeframe')
    if (replay.drawings !== undefined && (!Array.isArray(replay.drawings) || !replay.drawings.every(d => record(d) && typeof d.id === 'string' && ['trend','ray','horizontal','vertical','rectangle','fib','measure'].includes(d.type as string) && validPoint(d.a) && (['horizontal','vertical'].includes(d.type as string) ? d.b === undefined : validPoint(d.b))))) throw Error('Workspace has invalid replay drawings')
  }
  return data
}

export const blankWorkspace = (): Workspace => ({
  schemaVersion: 1,
  accounts: [{ id: 'primary', name: 'Primary account', currency: 'AUD' }],
  strategies: [], trades: [], reviews: [], timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', theme: 'dark', wallpaper: 'graphite', appearanceVersion: 2, riskNotebook: defaultRiskNotebook(), canvasCollections: []
})

export function prepareWorkspace(data: Workspace): Workspace {
  const trades = Array.isArray(data.trades) ? data.trades : []
  let accounts = Array.isArray(data.accounts) && data.accounts.length ? data.accounts : blankWorkspace().accounts
  if (!accounts.some(account => account.currency === 'AUD')) {
    const primary = accounts.find(account => account.id === 'primary' && account.currency === 'USD')
    if (primary && !trades.some(trade => trade.accountId === primary.id) && (!Array.isArray(data.reviews) || data.reviews.length === 0)) {
      accounts = accounts.map(account => account.id === primary.id ? { ...account, currency: 'AUD' } : account)
    } else {
      accounts = [...accounts, { id: 'aud-primary', name: 'AUD account', currency: 'AUD' }]
    }
  }
  return {
    ...data,
    accounts,
    theme: data.appearanceVersion === 2 ? data.theme : 'dark',
    wallpaper: data.wallpaper || 'graphite',
    appearanceVersion: 2,
    riskNotebook: data.riskNotebook || (() => { const legacy = data.riskProfiles?.['demo:primary'] || Object.values(data.riskProfiles || {})[0]; return legacy ? { ...defaultRiskNotebook(), perTradePct: legacy.perTradePct, minRewardRisk: legacy.minRewardRisk, dailyLossPct: legacy.dailyLossPct, weeklyDrawdownPct: legacy.weeklyDrawdownPct, maxDrawdownPct: legacy.maxDrawdownPct, reducedRiskPct: legacy.reducedRiskPct, lossStreakLimit: legacy.lossStreakLimit, cooldownHours: legacy.cooldownHours, reviewNotes: legacy.drawdownReviewNote || '' } : defaultRiskNotebook() })(),
    canvasCollections: data.canvasCollections || [],
  }
}

export const uid = () => crypto.randomUUID()
export const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
export const today = () => localDate(new Date())
export const money = (value: number, currency = 'AUD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value)
export const dateLabel = (value: string) => value ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
export const net = (trade: Trade) => trade.gross == null || ![trade.gross, trade.fees, trade.swap, trade.spread ?? 0].every(value => typeof value === 'number' && Number.isFinite(value)) ? null : trade.gross + trade.fees + trade.swap + (trade.spread ?? 0)
export const rMultiple = (trade: Trade) => {
  const value = net(trade)
  return value != null && trade.initialRisk != null && Number.isFinite(trade.initialRisk) && trade.initialRisk > 0 ? value / trade.initialRisk : null
}
export type Outcome = 'win' | 'loss' | 'breakeven'
export const currencyDigits = (currency = 'AUD') => new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits
export const outcome = (value: number, digits = 2): Outcome => {
  const rounded = Math.sign(value) * Math.round(Math.abs(value) * 10 ** digits)
  return rounded > 0 ? 'win' : rounded < 0 ? 'loss' : 'breakeven'
}
export const compliance = (trade: Trade, strategy?: Strategy): 'compliant' | 'noncompliant' | 'unassessed' => {
  const version = strategy?.versions.find(v => v.number === trade.strategyVersion)
  const required = version?.checklist.filter(c => c.required) || []
  if (!required.length) return 'unassessed'
  const answers = required.map(c => trade.checklist?.[c.id] || 'unassessed')
  if (answers.includes('no')) return 'noncompliant'
  return answers.every(a => a === 'yes') ? 'compliant' : 'unassessed'
}
export function metrics(trades: Trade[], strategies: Strategy[], currency = 'AUD') {
  const digits = currencyDigits(currency)
  const closed = trades.filter(t => t.status === 'closed' && net(t) != null)
  const results = closed.map(t => net(t)!)
  const eligible = closed.map(rMultiple).filter((x): x is number => x != null)
  const wins = results.filter(n => outcome(n, digits) === 'win').length
  const losses = results.filter(n => outcome(n, digits) === 'loss')
  const gains = results.filter(n => outcome(n, digits) === 'win')
  let balance = 0, peak = 0, drawdown = 0, rBalance = 0, rPeak = 0, rDrawdown = 0, streak = 0, longestStreak = 0
  for (const trade of closed.sort((a, b) => (a.exitedAt || a.enteredAt).localeCompare(b.exitedAt || b.enteredAt))) {
    const result = net(trade)!
    balance += result; peak = Math.max(peak, balance); drawdown = Math.max(drawdown, peak - balance)
    const r = rMultiple(trade)
    if (r != null) { rBalance += r; rPeak = Math.max(rPeak, rBalance); rDrawdown = Math.max(rDrawdown, rPeak - rBalance) }
    streak = outcome(result, digits) === 'loss' ? streak + 1 : 0; longestStreak = Math.max(longestStreak, streak)
  }
  const assessed = closed.map(t => compliance(t, strategies.find(s => s.id === t.strategyId))).filter(c => c !== 'unassessed')
  return {
    closed: closed.length, net: results.reduce((a, b) => a + b, 0), wins, winRate: closed.length ? wins / closed.length : null,
    netR: eligible.length ? eligible.reduce((a, b) => a + b, 0) : null,
    expectancy: eligible.length ? eligible.reduce((a, b) => a + b, 0) / eligible.length : null,
    eligibleR: eligible.length, missingR: closed.length - eligible.length,
    profitFactor: losses.length ? gains.reduce((a,b) => a+b, 0) / Math.abs(losses.reduce((a,b) => a+b, 0)) : null,
    drawdown, rDrawdown, longestStreak,
    adherence: assessed.length ? assessed.filter(a => a === 'compliant').length / assessed.length : null,
    assessed: assessed.length, unassessed: closed.length - assessed.length,
    averageWinR: eligible.filter(x => x > 0).length ? eligible.filter(x => x > 0).reduce((a,b) => a+b, 0) / eligible.filter(x => x > 0).length : null,
    averageLossR: eligible.filter(x => x < 0).length ? eligible.filter(x => x < 0).reduce((a,b) => a+b, 0) / eligible.filter(x => x < 0).length : null,
  }
}
