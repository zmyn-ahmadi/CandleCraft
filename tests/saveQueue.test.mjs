import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const output = await build({ entryPoints: ['src/saveQueue.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const moduleUrl = `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`
const { createSaveQueue } = await import(moduleUrl)

test('ordered saves keep the newest state when writes overlap', async () => {
  const written = []
  const finish = []
  const save = createSaveQueue(async value => {
    written.push(value)
    await new Promise(resolve => finish.push(resolve))
  })
  const first = save('first')
  const second = save('second')
  const third = save('third')
  assert.deepEqual(written, ['first'])
  finish.shift()()
  await first
  assert.deepEqual(written, ['first', 'third'])
  finish.shift()()
  await Promise.all([second, third])
  assert.deepEqual(written, ['first', 'third'])
})

test('a failed write does not block the next state', async () => {
  let first = true
  const written = []
  const save = createSaveQueue(async value => {
    if (first) { first = false; throw Error('disk full') }
    written.push(value)
  })
  const failed = save('old')
  const recovered = save('new')
  await assert.rejects(failed, /disk full/)
  await recovered
  assert.deepEqual(written, ['new'])
})
