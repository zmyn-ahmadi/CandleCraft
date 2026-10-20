import { uid, type Trade } from './model'

export function parseCsv(input: string, delimiter = ','): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  const source = input.replace(/^\uFEFF/, '')
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++ }
      else quoted = !quoted
    } else if (char === delimiter && !quoted) { row.push(cell.trim()); cell = '' }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i++
      row.push(cell.trim()); cell = ''
      if (row.some(Boolean)) rows.push(row)
      row = []
    } else cell += char
  }
  if (quoted) throw new Error('CSV contains an unclosed quote')
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

export type ImportField = 'symbol' | 'direction' | 'enteredAt' | 'exitedAt' | 'gross' | 'fees' | 'swap' | 'spread' | 'initialRisk' | 'externalRef' | 'size' | 'entryPrice' | 'exitPrice' | 'initialStop' | 'target' | 'balanceBefore' | 'valuePerPriceUnit' | 'setupTag' | 'ruleAdherence' | 'exitReason'
export const importFields: { key: ImportField; label: string; aliases: string[] }[] = [
  { key: 'symbol', label: 'Instrument', aliases: ['symbol', 'instrument', 'pair', 'market'] },
  { key: 'direction', label: 'Direction', aliases: ['direction', 'side', 'type'] },
  { key: 'enteredAt', label: 'Entry date', aliases: ['entrydate', 'openedat', 'opentime', 'entrytime', 'date'] },
  { key: 'exitedAt', label: 'Exit date', aliases: ['exitdate', 'closedat', 'closetime', 'exittime'] },
  { key: 'gross', label: 'Profit / loss', aliases: ['gross', 'grossprofit', 'profit', 'pnl', 'pl', 'netprofit'] },
  { key: 'fees', label: 'Fees', aliases: ['fees', 'commission', 'commissions'] },
  { key: 'swap', label: 'Swap / credit', aliases: ['swap', 'financing', 'interest'] },
  { key: 'spread', label: 'Spread cost', aliases: ['spread', 'spreadcost'] },
  { key: 'initialRisk', label: 'Initial monetary risk', aliases: ['initialrisk', 'risk', 'riskamount'] },
  { key: 'externalRef', label: 'Trade ID', aliases: ['tradeid', 'orderid', 'ticket', 'id', 'reference'] },
  { key: 'size', label: 'Size', aliases: ['size', 'volume', 'lots', 'quantity'] },
  { key: 'entryPrice', label: 'Entry price', aliases: ['entryprice', 'openprice'] },
  { key: 'exitPrice', label: 'Exit price', aliases: ['exitprice', 'closeprice'] },
  { key: 'initialStop', label: 'Initial stop', aliases: ['initialstop', 'stoploss', 'stop'] },
  { key: 'target', label: 'Planned target', aliases: ['target', 'takeprofit', 'profittarget'] },
  { key: 'balanceBefore', label: 'Balance before entry', aliases: ['balancebefore', 'accountbalance', 'startingbalance'] },
  { key: 'valuePerPriceUnit', label: 'AUD per price unit', aliases: ['valueperpriceunit', 'pointvalue', 'unitvalue'] },
  { key: 'setupTag', label: 'Setup tag', aliases: ['setuptag', 'setup', 'pattern'] },
  { key: 'ruleAdherence', label: 'Rule adherence', aliases: ['ruleadherence', 'followedplan', 'adherence'] },
  { key: 'exitReason', label: 'Exit reason', aliases: ['exitreason', 'closereason'] },
]
export type ColumnMap = Record<ImportField, number>
export function guessColumns(headers: string[]): ColumnMap {
  return Object.fromEntries(importFields.map(field => [field.key, headers.findIndex(h => field.aliases.includes(h.toLowerCase().replace(/[^a-z0-9]/g, '')))])) as ColumnMap
}
const numeric = (value: string, required = false): number | null => {
  const parenthesized = /^\s*\(.*\)\s*$/.test(value)
  const clean = value.replace(/[(),$£€\s]/g, '')
  if (!clean) { if (required) throw Error('Missing profit / loss'); return null }
  const parsed = Number(clean)
  if (!Number.isFinite(parsed)) throw Error(`Invalid number: ${value}`)
  return parenthesized ? -parsed : parsed
}
const isoDate = (value: string): string => {
  if (!value) throw Error('Missing date')
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw Error(`Invalid date: ${value}`)
  return date.toISOString().slice(0, 10)
}
export function importTrade(row: string[], columns: ColumnMap, accountId: string, environment: Trade['environment'], profitIsNet: boolean): Trade {
  const get = (field: ImportField) => columns[field] < 0 ? '' : (row[columns[field]] || '').trim()
  const symbol = get('symbol').toUpperCase().replace(/\s+/g, '')
  if (!symbol) throw Error('Missing instrument')
  const rawSide = get('direction').toLowerCase()
  const direction = ['buy', 'long', 'b'].includes(rawSide) ? 'long' : ['sell', 'short', 's'].includes(rawSide) ? 'short' : null
  if (!direction) throw Error(`Invalid direction: ${get('direction') || 'blank'}`)
  const enteredAt = isoDate(get('enteredAt'))
  const exitedAt = get('exitedAt') ? isoDate(get('exitedAt')) : enteredAt
  if (exitedAt < enteredAt) throw Error('Exit precedes entry')
  const result = numeric(get('gross'), true)!
  const fees = profitIsNet ? 0 : (numeric(get('fees')) || 0)
  const swap = profitIsNet ? 0 : (numeric(get('swap')) || 0)
  const spread = profitIsNet ? 0 : (numeric(get('spread')) || 0)
  const initialRisk = numeric(get('initialRisk'))
  if (initialRisk != null && initialRisk <= 0) throw Error('Initial risk must be positive')
  const entryPrice = numeric(get('entryPrice')), exitPrice = numeric(get('exitPrice')), size = numeric(get('size'))
  const initialStop = numeric(get('initialStop')), target = numeric(get('target')), balanceBefore = numeric(get('balanceBefore')), valuePerPriceUnit = numeric(get('valuePerPriceUnit'))
  const ruleAdherence = get('ruleAdherence').toLowerCase() || 'unassessed'
  const exitReason = get('exitReason').toLowerCase() || ''
  if (!['yes','no','unassessed'].includes(ruleAdherence)) throw Error('Rule adherence must be yes, no, or unassessed')
  if (!['','target','stop','manual','trailing','other'].includes(exitReason)) throw Error('Invalid exit reason')
  if ([initialStop,target].some(x => x != null && x <= 0) || [balanceBefore,valuePerPriceUnit].some(x => x != null && x <= 0)) throw Error('Risk prices and values must be positive')
  if ((entryPrice != null && entryPrice <= 0) || (exitPrice != null && exitPrice <= 0)) throw Error('Prices must be positive')
  if (size != null && size <= 0) throw Error('Size must be positive')
  const now = new Date().toISOString()
  return { id: uid(), accountId, environment, status: 'closed', symbol, direction, strategyId: '', strategyVersion: null,
    enteredAt, exitedAt, entryPrice, exitPrice, size,
    initialStop, target, initialRisk, gross: result, fees, swap, spread, balanceBefore, valuePerPriceUnit, setupTag: get('setupTag'), ruleAdherence: ruleAdherence as Trade['ruleAdherence'], exitReason: exitReason as Trade['exitReason'], externalRef: get('externalRef'), source: 'csv',
    reason: '', notes: profitIsNet ? 'Imported result was already net; costs were not added again.' : '', lesson: '', tags: [], checklist: {}, createdAt: now, updatedAt: now }
}
