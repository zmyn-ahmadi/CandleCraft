// MT5 positions from the mt5-api, as CandleCraft trades. Field mapping matches skills/candlecraft-mt5-sync/scripts/sync.py,
// so the in-app sync and the agent skill write identical trades under the same `mt5:<position id>` ref.
import { uid, type Environment, type Mt5Link, type Trade } from './model'

export interface Mt5Settings { url: string; token: string }
export interface Bar { time: number; open: number; high: number; low: number; close: number }
type Row = Record<string, any>
export interface Mt5Snapshot { account: Row; deals: Row[]; orders: Row[]; positions: Row[] }

const BUY = 0, SELL = 1, IN = 0, OUT = 1, OUT_BY = 3
const SL_HIT = 4, TP_HIT = 5 // DEAL_REASON_SL / DEAL_REASON_TP
export const DAY = 86_400

const SETTINGS_KEY = 'mt5-api'
// Kept out of the workspace so the token never lands in JSON exports or backups.
export const loadMt5Settings = (): Mt5Settings => { try { return { url: '', token: '', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } } catch { return { url: '', token: '' } } }
export const saveMt5Settings = (settings: Mt5Settings) => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))

async function api<T>(settings: Mt5Settings, path: string): Promise<T> {
  let response: Response
  try { response = await fetch(settings.url.replace(/\/+$/, '') + path, { headers: { Authorization: `Bearer ${settings.token}` } }) }
  catch { throw Error('mt5-api is not reachable. Check Tailscale and the server address.') }
  if (response.status === 401) throw Error('mt5-api refused the token')
  if (!response.ok) throw Error(`mt5-api ${path}: HTTP ${response.status}`)
  return response.json()
}

export async function fetchMt5(settings: Mt5Settings): Promise<Mt5Snapshot> {
  const [account, deals, orders, positions] = await Promise.all([
    api<Row>(settings, '/account'), api<Row[]>(settings, '/history/deals?days=3650'),
    api<Row[]>(settings, '/history/orders?days=3650'), api<Row[]>(settings, '/positions'),
  ])
  return { account, deals, orders, positions }
}

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits
const vwap = (ds: Row[]) => { const v = ds.reduce((a, d) => a + d.volume, 0); return v ? round(ds.reduce((a, d) => a + d.price * d.volume, 0) / v, 10) : null }
const sum = (ds: Row[], ...keys: string[]) => round(ds.reduce((a, d) => a + keys.reduce((b, k) => b + (d[k] || 0), 0), 0), 2)
const day = (time: number) => new Date(time * 1000).toISOString().slice(0, 10) // broker server date: deal times are server-clock epochs

/** One trade per position. `existing` keeps everything MT5 doesn't know: journal, strategy, risk, evidence. */
export function positionTrades(snapshot: Mt5Snapshot, accountId: string, environment: Environment, existing: Trade[]): Trade[] {
  const byPosition = new Map<number, Row[]>()
  for (const d of snapshot.deals) if ((d.type === BUY || d.type === SELL) && d.position_id) byPosition.set(d.position_id, [...(byPosition.get(d.position_id) || []), d])
  const orders = new Map(snapshot.orders.map(o => [o.ticket, o]))
  const open = new Set(snapshot.positions.map(p => p.identifier ?? p.ticket))
  const now = new Date().toISOString()
  const trades: Trade[] = []
  for (const [position, ds] of byPosition) {
    ds.sort((a, b) => a.time_msc - b.time_msc)
    const ins = ds.filter(d => d.entry === IN), outs = ds.filter(d => d.entry === OUT || d.entry === OUT_BY)
    if (!ins.length) continue // opened before the history window
    // Netting-account INOUT reversals are not split into two trades (hedging accounts only), as in sync.py.
    const closed = !open.has(position), last = outs.at(-1), order = orders.get(ins[0].order) || {}
    // A level added after the order was sent is only known from the exit that hit it.
    const stop = order.sl || (closed && last?.reason === SL_HIT ? last.price : null)
    const target = order.tp || (closed && last?.reason === TP_HIT ? last.price : null)
    const gross = sum(ds, 'profit')
    const reason = last?.reason === SL_HIT ? (gross > 0 ? 'trailing' : 'stop') : last?.reason === TP_HIT ? 'target' : 'manual'
    const ref = `mt5:${position}`
    const old = existing.find(t => t.externalRef === ref && t.accountId === accountId)
    const mt5: Mt5Link = { position, symbol: ins[0].symbol, openTime: ins[0].time, closeTime: closed && last ? last.time : null, deals: ds.map(d => ({ time: d.time, price: d.price, type: d.type })) }
    const base: Trade = old || { id: uid(), accountId, environment, status: 'open', symbol: '', direction: 'long', strategyId: '', strategyVersion: null, enteredAt: '', exitedAt: '', entryPrice: null, exitPrice: null, size: null, initialStop: null, target: null, initialRisk: null, gross: null, fees: 0, swap: 0, spread: 0, externalRef: ref, source: 'manual', reason: '', notes: '', lesson: '', tags: [], checklist: {}, setupTag: '', ruleAdherence: 'unassessed', exitReason: '', createdAt: now, updatedAt: now }
    const next: Trade = {
      ...base, accountId, environment, externalRef: ref, mt5,
      status: closed ? 'closed' : 'open', symbol: ins[0].symbol.split('.')[0], direction: ins[0].type === BUY ? 'long' : 'short',
      enteredAt: day(ins[0].time), exitedAt: closed && last ? day(last.time) : day(ins[0].time),
      entryPrice: vwap(ins), size: round(ins.reduce((a, d) => a + d.volume, 0), 4), initialStop: stop, target, fees: sum(ds, 'commission', 'fee'),
      ...(closed ? { exitPrice: vwap(outs), gross, swap: sum(ds, 'swap'), exitReason: reason } : {}),
    }
    trades.push(old && same(old, next) ? old : { ...next, updatedAt: old ? now : next.updatedAt })
  }
  return trades
}

const same = (a: Trade, b: Trade) => JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' })

/** Upserts every MT5 position into the workspace. Unchanged trades keep their object, so nothing is saved for them. */
export function mergeMt5<W extends { accounts: { id: string; currency: string }[]; trades: Trade[] }>(workspace: W, snapshot: Mt5Snapshot, fallbackAccountId: string) {
  const environment: Environment = snapshot.account.trade_mode === 2 ? 'live' : 'demo' // ACCOUNT_TRADE_MODE_REAL
  const matches = workspace.accounts.filter(a => a.currency === snapshot.account.currency)
  const accountId = matches.length === 1 ? matches[0].id : fallbackAccountId
  const incoming = positionTrades(snapshot, accountId, environment, workspace.trades)
  const byId = new Map(incoming.map(t => [t.id, t]))
  const kept = workspace.trades.map(t => byId.get(t.id) || t)
  const added = incoming.filter(t => !workspace.trades.some(o => o.id === t.id))
  const changed = added.length + incoming.filter(t => workspace.trades.some(o => o.id === t.id && o !== t)).length
  return { workspace: changed ? { ...workspace, trades: [...kept, ...added] } : workspace, added: added.length, changed, accountId, environment }
}

/** Every broker-server day the trade touches; `complete` once the last day is over and the candles can be cached for good. */
export function chartWindow(link: Mt5Link, now = Date.now() / 1000) {
  const start = link.openTime - link.openTime % DAY
  const end = Math.floor((link.closeTime ?? now + DAY) / DAY) * DAY + DAY // live: through today (server time runs ahead of UTC)
  return { start, end, complete: link.closeTime != null && now > end } // assumes a broker clock ahead of UTC, like GMT+2/+3
}

export async function fetchBars(settings: Mt5Settings, link: Mt5Link): Promise<Bar[]> {
  const { start, end } = chartWindow(link)
  const rows = await api<Row[]>(settings, `/rates?symbol=${encodeURIComponent(link.symbol)}&start=${start}&end=${end}&timeframe=M2`)
  return rows.map(({ time, open, high, low, close }) => ({ time, open, high, low, close }))
}
