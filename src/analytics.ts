import { currencyDigits, dateLabel, net, outcome, rMultiple, type Trade } from './model'

export interface CurvePoint { name: string; balance: number; r: number; trade: Trade }
export interface AnalyticsFilters { from: string; to: string; symbol: string; strategyId: string; direction: string }

export function filterTrades(trades: Trade[], filters: AnalyticsFilters): Trade[] {
  return trades.filter(trade => {
    const date = ((trade.status === 'closed' ? trade.exitedAt : trade.enteredAt) || trade.enteredAt).slice(0, 10)
    return (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to)
      && (filters.symbol === 'all' || trade.symbol === filters.symbol)
      && (filters.strategyId === 'all' || trade.strategyId === filters.strategyId)
      && (filters.direction === 'all' || trade.direction === filters.direction)
  })
}

export function analyticsSeries(trades: Trade[], currency = 'AUD') {
  const digits = currencyDigits(currency)
  const closed = trades
    .filter(trade => trade.status === 'closed' && net(trade) != null)
    .sort((a, b) => (a.exitedAt || a.enteredAt).localeCompare(b.exitedAt || b.enteredAt) || a.id.localeCompare(b.id))
  let balance = 0, cumulativeR = 0
  const curve: CurvePoint[] = closed.map(trade => {
    balance += net(trade)!
    cumulativeR += rMultiple(trade) ?? 0
    return { name: dateLabel(trade.exitedAt || trade.enteredAt), balance, r: cumulativeR, trade }
  })
  const counts = { win: 0, loss: 0, breakeven: 0 }
  closed.forEach(trade => { counts[outcome(net(trade)!, digits)]++ })
  return { curve, counts }
}

const closedWithNet = (trades: Trade[]) => trades.filter(trade => trade.status === 'closed' && net(trade) != null)
const closeDate = (trade: Trade) => (trade.exitedAt || trade.enteredAt).slice(0, 10)

/** Net result per calendar day (YYYY-MM-DD) for closed trades. */
export function dailyNet(trades: Trade[]): Map<string, number> {
  const days = new Map<string, number>()
  for (const trade of closedWithNet(trades)) days.set(closeDate(trade), (days.get(closeDate(trade)) ?? 0) + net(trade)!)
  return days
}

export interface BreakdownRow { key: string; trades: number; net: number; winRate: number; netR: number | null }

/** Closed-trade results grouped by any key (pair, strategy, rule adherence…), best net first. */
export function breakdown(trades: Trade[], keyOf: (trade: Trade) => string, currency = 'AUD'): BreakdownRow[] {
  const digits = currencyDigits(currency), groups = new Map<string, Trade[]>()
  for (const trade of closedWithNet(trades)) groups.set(keyOf(trade), [...(groups.get(keyOf(trade)) ?? []), trade])
  return [...groups].map(([key, group]) => {
    const rs = group.map(rMultiple).filter((r): r is number => r != null)
    return { key, trades: group.length, net: group.reduce((sum, t) => sum + net(t)!, 0), winRate: group.filter(t => outcome(net(t)!, digits) === 'win').length / group.length, netR: rs.length ? rs.reduce((a, b) => a + b, 0) : null }
  }).sort((a, b) => b.net - a.net)
}
