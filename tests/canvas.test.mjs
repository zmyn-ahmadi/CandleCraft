import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const load = async path => {
  const output = await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', write: false })
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`)
}
const { screenToWorld, zoomAt, contentBounds, newBoard, newCollection, moveItem, resizeItem, validateCanvasCollections } = await load('src/canvasModel.ts')
const { blankWorkspace, prepareWorkspace, validateWorkspace } = await load('src/model.ts')

test('collections hold multiple independent canvases and survive workspace round-trip', () => {
  const collection = newCollection('Trade ideas')
  const first = newBoard('Weekly map')
  const second = newBoard('Breakout notes')
  first.items.push({ id: 'stroke', kind: 'stroke', points: [{ x: 20, y: 30 }, { x: 80, y: 90 }], color: '#293a42', width: 3, opacity: 1 })
  second.items.push({ id: 'note', kind: 'note', x: 100, y: 100, width: 300, height: 210, color: 'sand', text: 'Wait for confirmation' })
  second.items.push({ id: 'picture', kind: 'image', x: 430, y: 100, width: 300, height: 200, name: 'chart.png', src: 'data:image/png;base64,YQ==' })
  second.items.push({ id: 'text', kind: 'text', x: -5000, y: 8000, width: 340, height: 140, color: '#293a42', fontSize: 24, text: 'Market structure\nWait for a retest' })
  collection.boards.push(first, second)
  const workspace = { ...blankWorkspace(), canvasCollections: [collection] }
  const restored = prepareWorkspace(validateWorkspace(JSON.parse(JSON.stringify(workspace))))
  assert.equal(restored.canvasCollections[0].boards.length, 2)
  assert.equal(restored.canvasCollections[0].boards[1].items[1].src, 'data:image/png;base64,YQ==')
  assert.equal(restored.canvasCollections[0].boards[0].items.length, 1)
  assert.deepEqual(restored.canvasCollections[0].boards[1].items[2], second.items[2])
})

test('items move in every direction beyond the old board and retain geometry', () => {
  const note = { id: 'note', kind: 'note', x: 100, y: 100, width: 300, height: 210, color: 'sand', text: '' }
  const moved = moveItem(note, 5000, 5000)
  assert.equal(moved.x, 5100)
  assert.equal(moved.y, 5100)
  const resized = resizeItem(note, -500, -500)
  assert.equal(resized.width, 180)
  assert.equal(resized.height, 120)
  const stroke = { id: 'stroke', kind: 'stroke', points: [{ x: 10, y: 10 }, { x: 40, y: 30 }], color: '#293a42', width: 2, opacity: 1 }
  const movedStroke = moveItem(stroke, -30, -30)
  assert.deepEqual(movedStroke.points, [{ x: -20, y: -20 }, { x: 10, y: 0 }])
})

test('invalid drawings and unsafe picture sources are rejected before restore', () => {
  const board = newBoard()
  const collection = { ...newCollection('Charts'), boards: [board] }
  assert.equal(validateCanvasCollections([collection]), true)
  const unsafe = { ...board, items: [{ id: 'image', kind: 'image', x: 0, y: 0, width: 300, height: 200, name: 'remote', src: 'https://example.com/image.png' }] }
  assert.equal(validateCanvasCollections([{ ...collection, boards: [unsafe] }]), false)
  const outside = { ...board, items: [{ id: 'line', kind: 'shape', shape: 'line', x1: Infinity, y1: 0, x2: 100, y2: 100, color: '#293a42', width: 2 }] }
  assert.throws(() => validateWorkspace({ ...blankWorkspace(), canvasCollections: [{ ...collection, boards: [outside] }] }), /invalid canvas/)
  const legacy = blankWorkspace()
  delete legacy.canvasCollections
  assert.deepEqual(prepareWorkspace(validateWorkspace(legacy)).canvasCollections, [])
})


test('camera preserves the world point beneath the cursor when zooming', () => {
  const camera = { x: -6000, y: 9000, zoom: .7 }
  const pointer = { x: 250, y: 180 }
  const before = screenToWorld(pointer, camera)
  const after = screenToWorld(pointer, zoomAt(camera, 2.4, pointer))
  assert.ok(Math.abs(before.x - after.x) < 1e-8)
  assert.ok(Math.abs(before.y - after.y) < 1e-8)
})

test('fit bounds includes distant text and drawings and invalid text cannot be restored', () => {
  const text = { id: 'text', kind: 'text', x: -5000, y: 9000, width: 340, height: 140, color: '#293a42', fontSize: 24, text: 'Ideas' }
  const bounds = contentBounds([text])
  assert.deepEqual(bounds, { x: -5000, y: 9000, width: 340, height: 140 })
  const collection = { ...newCollection('Ideas'), boards: [{ ...newBoard(), items: [text] }] }
  assert.equal(validateCanvasCollections([collection]), true)
  text.fontSize = 0
  assert.equal(validateCanvasCollections([collection]), false)
})
