export const BOARD_WIDTH = 1600
export const BOARD_HEIGHT = 1000
export const MAX_IMAGE_DATA_LENGTH = 4_000_000

export type BoardBackground = 'paper' | 'graphite' | 'blueprint'
export interface CanvasPoint { x: number; y: number }
export interface CanvasStroke { id: string; kind: 'stroke'; points: CanvasPoint[]; color: string; width: number; opacity: number }
export interface CanvasShape { id: string; kind: 'shape'; shape: 'line' | 'arrow' | 'rectangle'; x1: number; y1: number; x2: number; y2: number; color: string; width: number }
export interface CanvasNote { id: string; kind: 'note'; x: number; y: number; width: number; height: number; color: 'sand' | 'mint' | 'lilac' | 'slate'; text: string }
export interface CanvasImage { id: string; kind: 'image'; x: number; y: number; width: number; height: number; name: string; src: string }
export interface CanvasText { id: string; kind: 'text'; x: number; y: number; width: number; height: number; color: string; fontSize: number; text: string }
export type CanvasItem = CanvasStroke | CanvasShape | CanvasNote | CanvasImage | CanvasText
export interface CanvasBoard { id: string; title: string; background: BoardBackground; items: CanvasItem[]; createdAt: string; updatedAt: string }
export interface CanvasCollection { id: string; name: string; boards: CanvasBoard[]; createdAt: string; updatedAt: string }

const id = () => crypto.randomUUID()
export const newBoard = (title = 'Untitled canvas'): CanvasBoard => ({ id: id(), title, background: 'paper', items: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
export const newCollection = (name: string): CanvasCollection => ({ id: id(), name, boards: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
export const moveItem = (item: CanvasItem, dx: number, dy: number): CanvasItem => {
  if (item.kind === 'stroke') return { ...item, points: item.points.map(point => ({ x: point.x + dx, y: point.y + dy })) }
  if (item.kind === 'shape') return { ...item, x1: item.x1 + dx, y1: item.y1 + dy, x2: item.x2 + dx, y2: item.y2 + dy }
  return { ...item, x: item.x + dx, y: item.y + dy }
}
export const resizeItem = (item: CanvasNote | CanvasImage | CanvasText, dx: number, dy: number): CanvasNote | CanvasImage | CanvasText => ({ ...item, width: Math.max(180, item.width + dx), height: Math.max(item.kind === 'text' ? 40 : 120, item.height + dy) })
export interface CanvasCamera { x: number; y: number; zoom: number }
export const screenToWorld = (point: CanvasPoint, camera: CanvasCamera): CanvasPoint => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom })
export const zoomAt = (camera: CanvasCamera, zoom: number, point: CanvasPoint): CanvasCamera => {
  const world = screenToWorld(point, camera)
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom }
}
export const contentBounds = (items: CanvasItem[]) => {
  if (!items.length) return { x: 0, y: 0, width: BOARD_WIDTH, height: BOARD_HEIGHT }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity
  const include = (x: number, y: number, padding = 0) => { left = Math.min(left, x - padding); top = Math.min(top, y - padding); right = Math.max(right, x + padding); bottom = Math.max(bottom, y + padding) }
  for (const item of items) {
    if (item.kind === 'stroke') item.points.forEach(point => include(point.x, point.y, item.width))
    else if (item.kind === 'shape') { include(item.x1, item.y1, item.width + 12); include(item.x2, item.y2, item.width + 12) }
    else { include(item.x, item.y); include(item.x + item.width, item.y + item.height) }
  }
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max
const coord = (value: unknown) => finite(value)
const hex = (value: unknown) => typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
export const validImageSource = (value: unknown) => typeof value === 'string' && value.length <= MAX_IMAGE_DATA_LENGTH && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)

export function validateCanvasCollections(value: unknown): value is CanvasCollection[] {
  if (!Array.isArray(value) || value.length > 100) return false
  const validItem = (item: unknown) => {
    if (!object(item) || !text(item.id, 100)) return false
    if (item.kind === 'stroke') return Array.isArray(item.points) && item.points.length > 0 && item.points.length <= 10_000 && item.points.every(point => object(point) && coord(point.x) && coord(point.y)) && hex(item.color) && finite(item.width) && item.width > 0 && item.width <= 40 && finite(item.opacity) && item.opacity > 0 && item.opacity <= 1
    if (item.kind === 'shape') return ['line','arrow','rectangle'].includes(item.shape as string) && coord(item.x1) && coord(item.y1) && coord(item.x2) && coord(item.y2) && hex(item.color) && finite(item.width) && item.width > 0 && item.width <= 40
    if (item.kind === 'note' || item.kind === 'image' || item.kind === 'text') {
      if (!coord(item.x) || !coord(item.y) || !finite(item.width) || !finite(item.height) || item.width < 180 || item.height < (item.kind === 'text' ? 40 : 120)) return false
      if (item.kind === 'text') return hex(item.color) && finite(item.fontSize) && item.fontSize >= 12 && item.fontSize <= 96 && text(item.text, 50_000)
      return item.kind === 'note' ? ['sand','mint','lilac','slate'].includes(item.color as string) && text(item.text, 50_000) : text(item.name, 200) && validImageSource(item.src)
    }
    return false
  }
  return value.every(collection => object(collection) && text(collection.id, 100) && text(collection.name, 120) && text(collection.createdAt, 40) && text(collection.updatedAt, 40) && Array.isArray(collection.boards) && collection.boards.length <= 200 && collection.boards.every(board => object(board) && text(board.id, 100) && text(board.title, 120) && ['paper','graphite','blueprint'].includes(board.background as string) && text(board.createdAt, 40) && text(board.updatedAt, 40) && Array.isArray(board.items) && board.items.length <= 10_000 && board.items.every(validItem)))
}
