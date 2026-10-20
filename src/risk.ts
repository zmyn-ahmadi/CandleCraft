import type { RiskNotebook } from './model'

export function calculateRiskNotebook(note: RiskNotebook, now = new Date()) {
  const balance = note.balance && note.balance > 0 ? note.balance : null
  const riskCapital = balance == null ? null : balance * note.perTradePct / 100
  const stopDistance = note.entry != null && note.stop != null && note.entry > 0 && note.stop > 0 ? Math.abs(note.entry - note.stop) : null
  const validStop = stopDistance != null && stopDistance > 0 && (note.direction === 'long' ? note.stop! < note.entry! : note.stop! > note.entry!)
  const rewardDistance = note.entry != null && note.target != null ? (note.direction === 'long' ? note.target - note.entry : note.entry - note.target) : null
  const rewardRisk = validStop && rewardDistance != null && rewardDistance > 0 ? rewardDistance / stopDistance! : null
  const dailyBudget = note.dailyStart == null ? null : note.dailyStart * note.dailyLossPct / 100
  const dailyRemaining = dailyBudget == null || note.dailyPnl == null ? null : Math.max(0, dailyBudget + Math.min(0, note.dailyPnl))
  const weeklyDrawdown = balance != null && note.weeklyPeak != null && note.weeklyPeak > 0 ? Math.max(0, (note.weeklyPeak - balance) / note.weeklyPeak * 100) : null
  const currentDrawdown = balance != null && note.accountPeak != null && note.accountPeak > 0 ? Math.max(0, (note.accountPeak - balance) / note.accountPeak * 100) : null
  const tokens = note.equityHistory.split(/[,;\s]+/).filter(Boolean)
  const checkpoints = tokens.map(Number)
  const historyError = checkpoints.some(value => !Number.isFinite(value) || value <= 0)
  let historicalDrawdown = 0, historicalDrawdownCash = 0, historyPeak = checkpoints[0] || 0
  if (!historyError) for (const equity of checkpoints) { historyPeak = Math.max(historyPeak, equity); const loss = historyPeak - equity; const percent = historyPeak > 0 ? loss / historyPeak * 100 : 0; if (percent > historicalDrawdown) { historicalDrawdown = percent; historicalDrawdownCash = loss } }
  const maxDrawdown = !historyError && checkpoints.length >= 2 ? historicalDrawdown : null
  const maxDrawdownCash = !historyError && checkpoints.length >= 2 ? historicalDrawdownCash : null
  const reducedRisk = weeklyDrawdown != null && weeklyDrawdown >= note.weeklyDrawdownPct
  const suggestedRisk = balance == null ? null : balance * (reducedRisk ? Math.min(note.perTradePct, note.reducedRiskPct) : note.perTradePct) / 100
  const size = validStop && suggestedRisk != null && note.valuePerPriceUnit != null && note.valuePerPriceUnit > 0 ? suggestedRisk / (stopDistance! * note.valuePerPriceUnit) : null
  const grossAtTarget = size != null && rewardDistance != null && rewardDistance > 0 && note.valuePerPriceUnit != null ? size * rewardDistance * note.valuePerPriceUnit : null
  const netAtTarget = grossAtTarget == null ? null : grossAtTarget - note.estimatedFees
  const lastStop = note.lastStopAt ? new Date(note.lastStopAt).getTime() : NaN
  const cooldownUntil = note.consecutiveStopLosses >= note.lossStreakLimit && Number.isFinite(lastStop) ? new Date(lastStop + note.cooldownHours * 3_600_000) : null
  const cooldownActive = cooldownUntil != null && now.getTime() < cooldownUntil.getTime()
  const sample = note.wins != null && note.losses != null ? note.wins + note.losses : null
  const expectancy = sample && note.averageWin != null && note.averageLoss != null ? note.wins! / sample * note.averageWin - note.losses! / sample * note.averageLoss : null
  const profitFactor = note.grossProfit != null && note.grossLoss != null && note.grossLoss > 0 ? note.grossProfit / note.grossLoss : null
  const discipline = note.reviewedTrades && note.followedPlan != null ? note.followedPlan / note.reviewedTrades : null
  const alerts = [
    dailyRemaining === 0 ? 'Daily loss budget reached' : '',
    cooldownActive ? `Full-stop timeout until ${cooldownUntil!.toLocaleString()}` : '',
    reducedRisk ? `Weekly drawdown reached ${note.weeklyDrawdownPct}%; use reduced risk until balance recovers to the weekly peak` : '',
    (currentDrawdown != null && currentDrawdown >= note.maxDrawdownPct || maxDrawdown != null && maxDrawdown >= note.maxDrawdownPct) ? 'Maximum drawdown limit reached; pause and review your plan' : '',
  ].filter(Boolean)
  return { balance, riskCapital, stopDistance, validStop, rewardRisk, size, grossAtTarget, netAtTarget, dailyBudget, dailyRemaining, weeklyDrawdown, currentDrawdown, maxDrawdown, maxDrawdownCash, historyError, checkpointCount: checkpoints.length, reducedRisk, suggestedRisk, cooldownUntil, cooldownActive, sample, expectancy, profitFactor, discipline, alerts }
}
