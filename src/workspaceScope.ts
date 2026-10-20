import type { Environment, Workspace } from './model'

export interface WorkspaceScope { environment: Environment; accountId: string }
export function populatedScopes(workspace: Workspace) {
  return workspace.accounts.flatMap(account => (['demo', 'live', 'backtest'] as Environment[]).map(environment => ({
    accountId: account.id, accountName: account.name, environment,
    count: workspace.trades.filter(trade => trade.accountId === account.id && trade.environment === environment).length,
  }))).filter(scope => scope.count > 0).sort((a, b) => b.count - a.count)
}

export function initialScope(workspace: Workspace): WorkspaceScope {
  const saved = workspace.activeScope
  if (saved && ['demo', 'live', 'backtest'].includes(saved.environment) && workspace.accounts.some(account => account.id === saved.accountId)) return saved
  const scopes = populatedScopes(workspace)
  const preferred = scopes.find(scope => workspace.accounts.find(account => account.id === scope.accountId)?.currency === 'AUD') || scopes[0]
  if (preferred) return { environment: preferred.environment, accountId: preferred.accountId }
  return { environment: 'demo', accountId: workspace.accounts.find(account => account.currency === 'AUD')?.id || workspace.accounts[0]?.id || 'primary' }
}
