import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const output = await build({ entryPoints: ['src/workspaceScope.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { initialScope, populatedScopes } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
const workspace = { accounts: [{ id: 'primary', currency: 'USD', name: 'Empty' }, { id: 'aud', currency: 'AUD', name: 'AUD account' }, { id: 'usd', currency: 'USD', name: 'USD account' }], trades: [{ accountId: 'aud', environment: 'live' }, { accountId: 'usd', environment: 'live' }] }
test('legacy workspace opens populated AUD live account instead of empty demo', () => {
  assert.deepEqual(initialScope(workspace), { accountId: 'aud', environment: 'live' })
  assert.equal(populatedScopes(workspace).length, 2)
})
test('saved selection survives reload including intentionally empty demo views', () => {
  const activeScope = { accountId: 'aud', environment: 'demo' }
  assert.deepEqual(initialScope(JSON.parse(JSON.stringify({ ...workspace, activeScope }))), activeScope)
})
test('invalid or removed saved account falls back to existing records', () => {
  assert.deepEqual(initialScope({ ...workspace, activeScope: { accountId: 'removed', environment: 'live' } }), { accountId: 'aud', environment: 'live' })
  assert.deepEqual(initialScope({ ...workspace, activeScope: { accountId: 'aud', environment: 'invalid' } }), { accountId: 'aud', environment: 'live' })
})
