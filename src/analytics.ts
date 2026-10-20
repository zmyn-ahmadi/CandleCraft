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
