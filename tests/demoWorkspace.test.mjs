import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const output = await build({ stdin: { contents: "export * from './src/demoWorkspace'; export { validateWorkspace, prepareWorkspace, metrics } from './src/model'", resolveDir: '.', loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false })
const { demoWorkspace, validateWorkspace, prepareWorkspace, metrics } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)

test('demo workspace passes validation and produces metrics', () => {
  const workspace = prepareWorkspace(validateWorkspace(demoWorkspace()))
  assert.equal(workspace.accounts.length, 1)
  const result = metrics(workspace.trades, workspace.strategies, 'AUD')
  assert.equal(result.closed, 30)
  assert.ok(result.net > 0 && result.expectancy > 0)
  assert.ok(result.adherence > 0 && result.adherence < 1)
})
