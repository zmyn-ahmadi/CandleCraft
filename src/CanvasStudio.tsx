import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ArrowUpRight, Copy, Eraser, FolderPlus, Hand, Highlighter, ImagePlus, Maximize2, Minus, MoreHorizontal, MousePointer2, PenLine, Plus, Redo2, Square, StickyNote, Trash2, Type, Undo2, ZoomIn, ZoomOut, type LucideIcon } from 'lucide-react'
import { BOARD_HEIGHT, BOARD_WIDTH, MAX_IMAGE_DATA_LENGTH, clamp, contentBounds, screenToWorld, zoomAt, moveItem, newBoard, newCollection, resizeItem, type CanvasBoard, type CanvasCollection, type CanvasImage, type CanvasItem, type CanvasNote, type CanvasText, type CanvasCamera, type CanvasPoint, type CanvasShape, type CanvasStroke } from './canvasModel'

type Tool = 'select' | 'hand' | 'pen' | 'highlighter' | 'line' | 'arrow' | 'rectangle' | 'eraser' | 'note' | 'text' | 'image'
type Dialog = { kind: 'newCollection' | 'renameCollection' | 'newBoard' | 'renameBoard'; id?: string } | null
const tools: { id: Tool; label: string; icon: LucideIcon }[] = [
  { id: 'select', label: 'Select and move', icon: MousePointer2 }, { id: 'hand', label: 'Pan canvas', icon: Hand },
  { id: 'pen', label: 'Pen', icon: PenLine }, { id: 'highlighter', label: 'Highlighter', icon: Highlighter },
  { id: 'line', label: 'Line', icon: Minus }, { id: 'arrow', label: 'Arrow', icon: ArrowUpRight }, { id: 'rectangle', label: 'Rectangle', icon: Square },
  { id: 'eraser', label: 'Erase drawing', icon: Eraser }, { id: 'text', label: 'Type text', icon: Type }, { id: 'note', label: 'Add note', icon: StickyNote }, { id: 'image', label: 'Attach picture', icon: ImagePlus },
]
const colors = ['#293a42', '#f7f4ea', '#64c4ac', '#84b9db', '#d0a1d5', '#efad7f', '#e87575']
const now = () => new Date().toISOString()
const itemId = () => crypto.randomUUID()
const boardItem = (collections: CanvasCollection[], boardId: string) => collections.flatMap(collection => collection.boards).find(board => board.id === boardId)
const tinyMove = (a: CanvasPoint, b: CanvasPoint) => Math.hypot(a.x - b.x, a.y - b.y)

function NoteCard({ item, selected, focus, onSelect, onDrag, onResize, onText }: { item: CanvasNote | CanvasText; selected: boolean; focus: boolean; onSelect: () => void; onDrag: (e: ReactPointerEvent) => void; onResize: (e: ReactPointerEvent) => void; onText: (text: string) => void }) {
  const [text, setText] = useState(item.text)
  const timer = useRef<number | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const latest = useRef(text)
  const saved = useRef(item.text)
  const onTextRef = useRef(onText)
  latest.current = text
  saved.current = item.text
  onTextRef.current = onText
  useEffect(() => setText(item.text), [item.text])
  useEffect(() => { if (focus) input.current?.focus() }, [focus])
  useEffect(() => () => { if (timer.current != null) window.clearTimeout(timer.current); if (latest.current !== saved.current) onTextRef.current(latest.current) }, [item.id])
  const flush = () => { if (timer.current != null) window.clearTimeout(timer.current); timer.current = null; if (latest.current !== item.text) onText(latest.current) }
  return <div className={`canvas-note ${item.kind === 'text' ? 'canvas-text' : `note-${item.color}`} ${selected ? 'selected' : ''}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height }} onPointerDown={e => { e.stopPropagation(); onSelect() }}>
    <div className="canvas-note-handle" onPointerDown={onDrag}><span className="canvas-grip">⋮⋮</span><span>{item.kind === 'text' ? 'TEXT' : 'NOTE'}</span></div>
    <textarea ref={input} value={text} maxLength={50_000} aria-label={item.kind === 'text' ? 'Canvas text' : 'Note text'} style={item.kind === 'text' ? { color: item.color, fontSize: item.fontSize } : undefined} placeholder={item.kind === 'text' ? 'Type here…' : 'Write a thought, lesson, or setup…'} onPointerDown={e => { e.stopPropagation(); onSelect() }} onChange={e => { setText(e.target.value); latest.current = e.target.value; if (timer.current != null) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => onTextRef.current(latest.current), 600) }} onBlur={flush} />
    {selected && <button className="canvas-resize-handle" title="Resize note" aria-label="Resize note" onPointerDown={onResize}><Maximize2 size={11} /></button>}
  </div>
}

async function imageData(file: File): Promise<{ src: string; width: number; height: number }> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw Error('Choose a PNG, JPEG, or WebP picture')
  if (file.size > 12_000_000) throw Error('Picture must be under 12 MB before import')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const create = (limit: number, quality: number) => {
      const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/webp', quality)
    }
    let src = create(2400, .9)
    if (src.length > MAX_IMAGE_DATA_LENGTH) src = create(1600, .76)
    if (src.length > MAX_IMAGE_DATA_LENGTH) throw Error('Picture is too detailed to save on a canvas. Try a smaller image.')
    const ratio = image.naturalWidth / image.naturalHeight
    const width = clamp(Math.round(Math.min(560, 430 * ratio)), 180, 650)
    const height = clamp(Math.round(width / ratio), 120, 520)
    return { src, width, height }
  } finally { URL.revokeObjectURL(url) }
}

export default function CanvasStudio({ collections, onChange }: { collections: CanvasCollection[]; onChange: (collections: CanvasCollection[]) => void }) {
  const collectionsRef = useRef(collections)
  collectionsRef.current = collections
  const [collectionId, setCollectionId] = useState<string | null>(collections[0]?.id || null)
  const [boardId, setBoardId] = useState<string | null>(collections[0]?.boards[0]?.id || null)
  const [tool, setTool] = useState<Tool>('select')
  const [ink, setInk] = useState(colors[0])
  const [brush, setBrush] = useState(3)
  const [camera, setCamera] = useState<CanvasCamera>({ x: 60, y: 60, zoom: .7 })
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const zoom = camera.zoom
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusNoteId, setFocusNoteId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CanvasStroke | CanvasShape | null>(null)
  const [preview, setPreview] = useState<CanvasItem | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [dialogName, setDialogName] = useState('')
  const [notice, setNotice] = useState('')
  const [, setHistoryTick] = useState(0)
  const viewportRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<CanvasStroke | CanvasShape | null>(null)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const dragCleanup = useRef<(() => void) | null>(null)
  const historyRef = useRef<Record<string, { past: CanvasItem[][]; future: CanvasItem[][] }>>({})

  const activeCollection = collections.find(collection => collection.id === collectionId) || null
  const activeBoard = activeCollection?.boards.find(board => board.id === boardId) || null
  const selectedItem = activeBoard?.items.find(item => item.id === selectedId) || null
  const history = activeBoard ? historyRef.current[activeBoard.id] : null
  useEffect(() => { if (collectionId && collections.some(collection => collection.id === collectionId)) return; setCollectionId(collections[0]?.id || null); setBoardId(collections[0]?.boards[0]?.id || null) }, [collections, collectionId])
  useEffect(() => { if (!activeCollection) return; if (boardId && activeCollection.boards.some(board => board.id === boardId)) return; setBoardId(activeCollection.boards[0]?.id || null) }, [activeCollection, boardId])
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 4200); return () => window.clearTimeout(timer) }, [notice])
  useEffect(() => () => dragCleanup.current?.(), [])

  const change = (update: (current: CanvasCollection[]) => CanvasCollection[]) => { const next = update(collectionsRef.current); collectionsRef.current = next; onChange(next) }
  const patchBoard = (targetId: string, update: (board: CanvasBoard) => CanvasBoard) => change(current => current.map(collection => collection.boards.some(board => board.id === targetId) ? { ...collection, updatedAt: now(), boards: collection.boards.map(board => board.id === targetId ? { ...update(board), updatedAt: now() } : board) } : collection))
  const record = (targetId: string, items: CanvasItem[]) => {
    const current = boardItem(collectionsRef.current, targetId)
    if (!current || current.items === items) return
    const entry = historyRef.current[targetId] || { past: [], future: [] }
    entry.past.push(current.items)
    if (entry.past.length > 50) entry.past.shift()
    entry.future = []
    historyRef.current[targetId] = entry
    patchBoard(targetId, board => ({ ...board, items }))
    setHistoryTick(value => value + 1)
  }
  const updateItem = (targetBoard: string, id: string, update: (item: CanvasItem) => CanvasItem) => { const board = boardItem(collectionsRef.current, targetBoard); if (board?.items.some(item => item.id === id)) record(targetBoard, board.items.map(item => item.id === id ? update(item) : item)) }
  const removeItem = (id: string) => { if (!activeBoard) return; record(activeBoard.id, activeBoard.items.filter(item => item.id !== id)); setSelectedId(null) }
  const undo = () => { if (!activeBoard) return; const entry = historyRef.current[activeBoard.id], current = boardItem(collectionsRef.current, activeBoard.id); if (!entry?.past.length || !current) return; const items = entry.past.pop()!; entry.future.push(current.items); patchBoard(activeBoard.id, board => ({ ...board, items })); setSelectedId(null); setHistoryTick(value => value + 1) }
  const redo = () => { if (!activeBoard) return; const entry = historyRef.current[activeBoard.id], current = boardItem(collectionsRef.current, activeBoard.id); if (!entry?.future.length || !current) return; const items = entry.future.pop()!; entry.past.push(current.items); patchBoard(activeBoard.id, board => ({ ...board, items })); setSelectedId(null); setHistoryTick(value => value + 1) }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (dialog) return
      if ((event.target as HTMLElement)?.closest('input,textarea,[contenteditable]')) return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo() }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedId) { event.preventDefault(); removeItem(selectedId) }
      else if (event.key === 'Escape') { setSelectedId(null); setTool('select') }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  const coordinate = (clientX: number, clientY: number): CanvasPoint => { const rect = surfaceRef.current!.getBoundingClientRect(); return screenToWorld({ x: clientX - rect.left, y: clientY - rect.top }, cameraRef.current) }
  const visibleCenter = (): CanvasPoint => { const view = viewportRef.current; return screenToWorld({ x: (view?.clientWidth || 900) / 2, y: (view?.clientHeight || 600) / 2 }, cameraRef.current) }
  const setZoom = (update: (zoom: number) => number) => { const view = viewportRef.current; setCamera(current => zoomAt(current, update(current.zoom), { x: (view?.clientWidth || 900) / 2, y: (view?.clientHeight || 600) / 2 })) }
  useEffect(() => { setCamera({ x: 60, y: 60, zoom: .7 }); setDraft(null); draftRef.current = null; panRef.current = null; setSelectedId(null); if (activeBoard) { matchInk(activeBoard.background); fit() } }, [boardId])
  useEffect(() => {
    const view = viewportRef.current
    if (!view) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('textarea') && !event.ctrlKey && !event.metaKey) return
      event.preventDefault()
      const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.clientHeight : 1
      const dx = event.deltaX * factor, dy = event.deltaY * factor
      if (event.ctrlKey || event.metaKey) { const rect = view.getBoundingClientRect(); setCamera(current => zoomAt(current, clamp(current.zoom * Math.exp(-dy * .01), .1, 3), { x: event.clientX - rect.left, y: event.clientY - rect.top })) }
      else setCamera(current => ({ ...current, x: current.x - (event.shiftKey && !dx ? dy : dx), y: current.y - (event.shiftKey && !dx ? 0 : dy) }))
    }
    view.addEventListener('wheel', wheel, { passive: false })
    return () => view.removeEventListener('wheel', wheel)
  }, [activeBoard?.id])
  const addNote = (point: CanvasPoint, plain = false) => { if (!activeBoard) return; const item: CanvasNote | CanvasText = plain ? { id: itemId(), kind: 'text', ...point, width: 340, height: 140, text: '', color: ink, fontSize: 24 } : { id: itemId(), kind: 'note', ...point, width: 300, height: 210, text: '', color: 'sand' }; record(activeBoard.id, [...activeBoard.items, item]); setSelectedId(item.id); setFocusNoteId(item.id); setTool('select') }
  const addImage = async (file: File, targetBoard: string, point: CanvasPoint) => { try { const data = await imageData(file); const board = boardItem(collectionsRef.current, targetBoard); if (!board) return; const item: CanvasImage = { id: itemId(), kind: 'image', x: point.x, y: point.y, width: data.width, height: data.height, name: file.name.slice(0, 200), src: data.src }; record(targetBoard, [...board.items, item]); setSelectedId(item.id); setTool('select') } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not attach picture') } }
  const pickImage = () => fileRef.current?.click()
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!activeBoard || (event.button !== 0 && event.button !== 1)) return
    if (event.button === 1 || tool === 'hand') { event.preventDefault(); panRef.current = { x: event.clientX, y: event.clientY, left: camera.x, top: camera.y }; event.currentTarget.setPointerCapture(event.pointerId); return }
    const point = coordinate(event.clientX, event.clientY)
    if (tool === 'select' || tool === 'eraser') { setSelectedId(null); return }
    if (tool === 'note' || tool === 'text') { addNote(point, tool === 'text'); return }
    if (tool === 'image') { pickImage(); return }
    if (tool === 'pen' || tool === 'highlighter') draftRef.current = { id: itemId(), kind: 'stroke', points: [point], color: tool === 'highlighter' && ink === colors[0] ? '#efca72' : ink, width: tool === 'highlighter' ? Math.min(40, Math.max(14, brush * 4)) : brush, opacity: tool === 'highlighter' ? .4 : 1 }
    else draftRef.current = { id: itemId(), kind: 'shape', shape: tool === 'rectangle' ? 'rectangle' : tool, x1: point.x, y1: point.y, x2: point.x, y2: point.y, color: ink, width: brush }
    setDraft(draftRef.current)
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current) { const pan = panRef.current; setCamera(current => ({ ...current, x: pan.left + event.clientX - pan.x, y: pan.top + event.clientY - pan.y })); return }
    const current = draftRef.current
    if (!current) return
    const point = coordinate(event.clientX, event.clientY)
    if (current.kind === 'stroke') { if (tinyMove(current.points.at(-1)!, point) < 1.5) return; draftRef.current = { ...current, points: [...current.points, point].slice(0, 10_000) } }
    else draftRef.current = { ...current, x2: point.x, y2: point.y }
    setDraft(draftRef.current)
  }
  const onPointerUp = () => { panRef.current = null; const item = draftRef.current; draftRef.current = null; setDraft(null); if (!item || !activeBoard) return; if (item.kind === 'shape' && tinyMove({ x: item.x1, y: item.y1 }, { x: item.x2, y: item.y2 }) < 3) return; record(activeBoard.id, [...activeBoard.items, item]) }
  const beginDrag = (event: ReactPointerEvent, item: CanvasItem, mode: 'move' | 'resize') => {
    if (tool !== 'select') return
    event.preventDefault(); event.stopPropagation(); setSelectedId(item.id); setFocusNoteId(null)
    dragCleanup.current?.()
    const startX = event.clientX, startY = event.clientY, targetBoard = activeBoard!.id, currentZoom = zoom
    const moved = (clientX: number, clientY: number): CanvasItem => { const dx = (clientX - startX) / currentZoom, dy = (clientY - startY) / currentZoom; return mode === 'resize' && (item.kind === 'note' || item.kind === 'image' || item.kind === 'text') ? resizeItem(item, dx, dy) : moveItem(item, dx, dy) }
    let latest = item
    const move = (e: PointerEvent) => { latest = moved(e.clientX, e.clientY); setPreview(latest) }
    const finish = (e: PointerEvent) => { latest = moved(e.clientX, e.clientY); cleanup(); setPreview(null); if (JSON.stringify(latest) !== JSON.stringify(item)) updateItem(targetBoard, item.id, () => latest) }
    const cleanup = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', cancel); dragCleanup.current = null }
    const cancel = () => { cleanup(); setPreview(null) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', cancel)
    dragCleanup.current = cleanup
  }

  const launchDialog = (kind: NonNullable<Dialog>['kind'], id?: string, initial = '') => { setDialog({ kind, id }); setDialogName(initial) }
  const saveDialog = () => {
    if (!dialog) return
    const name = dialogName.trim().slice(0, 120)
    if (!name) { setNotice('Enter a name first'); return }
    if (dialog.kind === 'newCollection') { const collection = newCollection(name), board = newBoard(); collection.boards.push(board); change(current => [...current, collection]); setCollectionId(collection.id); setBoardId(board.id) }
    if (dialog.kind === 'renameCollection') change(current => current.map(collection => collection.id === dialog.id ? { ...collection, name, updatedAt: now() } : collection))
    if (dialog.kind === 'newBoard' && activeCollection) { const board = newBoard(name); change(current => current.map(collection => collection.id === activeCollection.id ? { ...collection, boards: [...collection.boards, board], updatedAt: now() } : collection)); setBoardId(board.id) }
    if (dialog.kind === 'renameBoard' && dialog.id) patchBoard(dialog.id, board => ({ ...board, title: name }))
    setSelectedId(null); setDialog(null)
  }
  const deleteCollection = (collection: CanvasCollection) => { if (!window.confirm(`Delete “${collection.name}” and its ${collection.boards.length} canvas${collection.boards.length === 1 ? '' : 'es'}? This cannot be undone.`)) return; change(current => current.filter(item => item.id !== collection.id)); if (collectionId === collection.id) { const remaining = collectionsRef.current[0]; setCollectionId(remaining?.id || null); setBoardId(remaining?.boards[0]?.id || null) } }
  const deleteBoard = (board: CanvasBoard) => { if (!activeCollection || !window.confirm(`Delete “${board.title}” and everything on it? This cannot be undone.`)) return; change(current => current.map(collection => collection.id === activeCollection.id ? { ...collection, boards: collection.boards.filter(item => item.id !== board.id), updatedAt: now() } : collection)); delete historyRef.current[board.id]; setBoardId(collectionsRef.current.find(collection => collection.id === activeCollection.id)?.boards[0]?.id || null); setSelectedId(null) }
  const duplicateBoard = () => { if (!activeBoard || !activeCollection) return; const copy: CanvasBoard = { ...newBoard(`${activeBoard.title} copy`), background: activeBoard.background, items: activeBoard.items.map(item => ({ ...item, id: itemId() })) }; change(current => current.map(collection => collection.id === activeCollection.id ? { ...collection, boards: [...collection.boards, copy], updatedAt: now() } : collection)); setBoardId(copy.id); setSelectedId(null) }
  const matchInk = (background: CanvasBoard['background']) => setInk(current => background === 'paper' && current === colors[1] ? colors[0] : background !== 'paper' && current === colors[0] ? colors[1] : current)
  const changeBackground = (background: CanvasBoard['background']) => { if (activeBoard) { patchBoard(activeBoard.id, board => ({ ...board, background })); matchInk(background) } }
  const selectCollection = (collection: CanvasCollection) => { setCollectionId(collection.id); setBoardId(collection.boards[0]?.id || null); setSelectedId(null); if (collection.boards[0]) matchInk(collection.boards[0].background) }
  const selectBoard = (board: CanvasBoard) => { setBoardId(board.id); setSelectedId(null); setDraft(null); draftRef.current = null; matchInk(board.background) }
  const fit = () => { const view = viewportRef.current; if (!view || !activeBoard) return; const bounds = contentBounds(activeBoard.items); const scale = Math.min(1.5, Math.max(.0001, Math.min((view.clientWidth - 100) / bounds.width, (view.clientHeight - 100) / bounds.height))); setCamera({ zoom: scale, x: (view.clientWidth - bounds.width * scale) / 2 - bounds.x * scale, y: (view.clientHeight - bounds.height * scale) / 2 - bounds.y * scale }) }

  const paintItem = (item: CanvasStroke | CanvasShape, key: string, transient = false) => {
    const selected = selectedId === item.id && !transient
    const interactive = !transient && (tool === 'select' || tool === 'eraser')
    const hit = (e: ReactPointerEvent) => { if (!interactive) return; e.stopPropagation(); if (tool === 'eraser') { removeItem(item.id); return } beginDrag(e, item, 'move') }
    const base = { stroke: item.color, strokeWidth: item.width, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, opacity: item.kind === 'stroke' ? item.opacity : 1 }
    return <g key={key} className={selected ? 'canvas-drawing-selected' : ''}>
      {item.kind === 'stroke' ? <>{item.points.length === 1 ? <circle cx={item.points[0].x} cy={item.points[0].y} r={item.width / 2} fill={item.color} opacity={item.opacity} /> : <polyline points={item.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" {...base} />}{interactive && (item.points.length === 1 ? <circle cx={item.points[0].x} cy={item.points[0].y} r={Math.max(9, item.width / 2 + 6)} fill="transparent" pointerEvents="all" onPointerDown={hit} /> : <polyline points={item.points.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke="transparent" strokeWidth={Math.max(16, item.width + 12)} pointerEvents="stroke" onPointerDown={hit} />)}</> : item.shape === 'rectangle' ? <><rect x={Math.min(item.x1, item.x2)} y={Math.min(item.y1, item.y2)} width={Math.abs(item.x2 - item.x1)} height={Math.abs(item.y2 - item.y1)} fill="transparent" {...base} />{interactive && <rect x={Math.min(item.x1, item.x2)} y={Math.min(item.y1, item.y2)} width={Math.abs(item.x2 - item.x1)} height={Math.abs(item.y2 - item.y1)} fill="transparent" stroke="transparent" strokeWidth={16} pointerEvents="all" onPointerDown={hit} />}</> : <><line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} {...base} />{item.shape === 'arrow' && <path d={`M ${item.x2} ${item.y2} l ${-12 * Math.cos(Math.atan2(item.y2-item.y1,item.x2-item.x1)-.55)} ${-12 * Math.sin(Math.atan2(item.y2-item.y1,item.x2-item.x1)-.55)} M ${item.x2} ${item.y2} l ${-12 * Math.cos(Math.atan2(item.y2-item.y1,item.x2-item.x1)+.55)} ${-12 * Math.sin(Math.atan2(item.y2-item.y1,item.x2-item.x1)+.55)}`} fill="none" {...base} />}{interactive && <line x1={item.x1} y1={item.y1} x2={item.x2} y2={item.y2} stroke="transparent" strokeWidth={Math.max(16, item.width + 12)} pointerEvents="stroke" onPointerDown={hit} />}</>}
    </g>
  }

  return <div className="canvas-studio">
    <aside className="card canvas-library"><div className="canvas-library-heading"><div><span className="eyebrow">YOUR STUDIO</span><h2>Collections</h2></div><button className="icon-button" title="New collection" aria-label="New collection" onClick={() => launchDialog('newCollection')}><FolderPlus size={18} /></button></div><div className="canvas-library-scroll">{collections.length ? collections.map(collection => <div key={collection.id} className="canvas-collection-group"><button className={`canvas-collection-item ${collection.id === collectionId ? 'active' : ''}`} onClick={() => selectCollection(collection)}><span className="canvas-folder-mark" /><span><strong>{collection.name}</strong><small>{collection.boards.length} canvas{collection.boards.length === 1 ? '' : 'es'}</small></span></button>{collection.id === collectionId && <div className="canvas-board-list">{collection.boards.map(board => <button className={`canvas-board-item ${board.id === boardId ? 'active' : ''}`} key={board.id} onClick={() => selectBoard(board)}><Square size={14} /><span>{board.title}</span></button>)}<button className="canvas-board-add" onClick={() => launchDialog('newBoard')}><Plus size={14} /> New canvas</button></div>}</div>) : <div className="canvas-library-empty">Create a collection to start gathering ideas, charts, and notes.</div>}</div>{activeCollection && <div className="canvas-library-footer"><button title="Rename collection" onClick={() => launchDialog('renameCollection', activeCollection.id, activeCollection.name)}>Rename</button><button title="Delete collection" onClick={() => deleteCollection(activeCollection)}>Delete</button></div>}<button className="button secondary canvas-new-collection" onClick={() => launchDialog('newCollection')}><Plus size={16} /> New collection</button></aside>

    <section className="canvas-workspace"><div className="card canvas-workspace-head"><div><span className="eyebrow">{activeCollection?.name || 'CANVAS STUDIO'}</span><h2>{activeBoard?.title || 'Your ideas start here'}</h2><p>{activeBoard ? `${activeBoard.items.length} item${activeBoard.items.length === 1 ? '' : 's'} · changes save locally` : 'Create a collection and canvas to begin.'}</p></div>{activeBoard && <div className="canvas-head-actions"><button className="button secondary" onClick={() => launchDialog('renameBoard', activeBoard.id, activeBoard.title)}>Rename</button><button className="icon-button" title="Duplicate canvas" aria-label="Duplicate canvas" onClick={duplicateBoard}><Copy size={17} /></button><button className="icon-button" title="Delete canvas" aria-label="Delete canvas" onClick={() => deleteBoard(activeBoard)}><Trash2 size={17} /></button></div>}</div>
      {activeBoard ? <><div className="card canvas-toolbar"><div className="canvas-tool-group">{tools.map(entry => <button key={entry.id} className={tool === entry.id ? 'active' : ''} title={entry.label} aria-label={entry.label} aria-pressed={tool === entry.id} onClick={() => { setTool(entry.id); if (entry.id === 'image') pickImage(); if (entry.id !== 'select') setSelectedId(null) }}><entry.icon size={17} /></button>)}</div><span className="canvas-toolbar-divider" /><div className="canvas-color-group" aria-label="Drawing color">{colors.map(color => <button key={color} className={ink === color ? 'active' : ''} style={{ background: color }} title={`Color ${color}`} aria-label={`Color ${color}`} aria-pressed={ink === color} onClick={() => { setInk(color); if (selectedItem?.kind === 'text') updateItem(activeBoard.id, selectedItem.id, item => item.kind === 'text' ? { ...item, color } : item) }} />)}</div><label className="canvas-brush"><span>{brush}px</span><input type="range" min="1" max="18" value={brush} aria-label="Brush width" onChange={e => setBrush(Number(e.target.value))} /></label><span className="canvas-toolbar-spacer" /><button className="canvas-toolbar-action" title="Undo" aria-label="Undo" disabled={!history?.past.length} onClick={undo}><Undo2 size={16} /></button><button className="canvas-toolbar-action" title="Redo" aria-label="Redo" disabled={!history?.future.length} onClick={redo}><Redo2 size={16} /></button><span className="canvas-toolbar-divider" /><button className="canvas-toolbar-action" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom(value => clamp(Math.round((value - .1) * 10) / 10, .1, 3))}><ZoomOut size={16} /></button><span className="canvas-zoom-label">{Math.round(zoom * 100)}%</span><button className="canvas-toolbar-action" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom(value => clamp(Math.round((value + .1) * 10) / 10, .1, 3))}><ZoomIn size={16} /></button><button className="canvas-toolbar-action" title="Fit all content" aria-label="Fit all content" onClick={fit}><Maximize2 size={16} /></button></div>
        <div className="canvas-context"><span>{tool === 'select' ? 'Select a note, picture, or drawing to move it.' : tool === 'eraser' ? 'Click a drawing to erase it.' : tool === 'hand' ? 'Drag to pan the canvas.' : tool === 'text' ? 'Click anywhere to type text.' : tool === 'note' ? 'Click the canvas to place a note.' : tool === 'image' ? 'Choose a picture, or drop one onto the canvas.' : 'Drag on the canvas to draw.'}</span><label>BACKGROUND <select value={activeBoard.background} onChange={e => changeBackground(e.target.value as CanvasBoard['background'])}><option value="paper">Warm paper</option><option value="graphite">Graphite</option><option value="blueprint">Blueprint</option></select></label></div>
        {selectedItem && <div className="canvas-selection-strip"><span><MousePointer2 size={14} /> {selectedItem.kind === 'text' ? 'Text selected' : selectedItem.kind === 'note' ? 'Note selected' : selectedItem.kind === 'image' ? 'Picture selected' : 'Drawing selected'}</span>{selectedItem.kind === 'text' && <label className="canvas-font-size">Text size <select aria-label="Text size" value={selectedItem.fontSize} onChange={e => updateItem(activeBoard.id, selectedItem.id, item => item.kind === 'text' ? { ...item, fontSize: Number(e.target.value) } : item)}>{[12,16,20,24,32,40,48,64,96].map(size => <option key={size} value={size}>{size}px</option>)}</select></label>}{selectedItem.kind === 'note' && <div className="canvas-note-swatches">{(['sand','mint','lilac','slate'] as CanvasNote['color'][]).map(color => <button key={color} className={`note-${color} ${selectedItem.color === color ? 'active' : ''}`} title={`${color} note`} aria-label={`${color} note`} onClick={() => updateItem(activeBoard.id, selectedItem.id, item => item.kind === 'note' ? { ...item, color } : item)} />)}</div>}<button onClick={() => { const board = boardItem(collectionsRef.current, activeBoard.id); if (board) { record(activeBoard.id, [...board.items.filter(item => item.id !== selectedItem.id), selectedItem]); setSelectedId(selectedItem.id) } }}>Bring to front</button><button className="canvas-delete-selection" onClick={() => removeItem(selectedItem.id)}><Trash2 size={14} /> Delete</button></div>}
        <div className="canvas-viewport" ref={viewportRef} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }} onDrop={e => { e.preventDefault(); const file = [...e.dataTransfer.files].find(item => item.type.startsWith('image/')); if (file) void addImage(file, activeBoard.id, coordinate(e.clientX, e.clientY)); else setNotice('Drop a PNG, JPEG, or WebP picture') }} onPaste={e => { if ((e.target as HTMLElement).closest('textarea,input')) return; const file = [...e.clipboardData.files].find(item => item.type.startsWith('image/')); if (file) { e.preventDefault(); void addImage(file, activeBoard.id, visibleCenter()) } }} tabIndex={0} aria-label={`${activeBoard.title} canvas`}>
          <div ref={surfaceRef} className={`canvas-surface board-${activeBoard.background} tool-${tool}`} style={{ backgroundPosition: `${camera.x}px ${camera.y}px`, backgroundSize: `${(activeBoard.background === 'blueprint' ? 30 : 25) * zoom}px ${(activeBoard.background === 'blueprint' ? 30 : 25) * zoom}px` }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { draftRef.current = null; setDraft(null); panRef.current = null }}>
          <div className="canvas-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${zoom})` }}>
            {activeBoard.items.filter(item => item.kind === 'note' || item.kind === 'image' || item.kind === 'text').map(raw => { const item = preview?.id === raw.id ? preview : raw; return item.kind === 'note' || item.kind === 'text' ? <NoteCard key={item.id} item={item} selected={selectedId === item.id} focus={focusNoteId === item.id} onSelect={() => { setSelectedId(item.id); setFocusNoteId(null) }} onDrag={e => beginDrag(e, item, 'move')} onResize={e => beginDrag(e, item, 'resize')} onText={text => updateItem(activeBoard.id, item.id, current => current.kind === 'note' || current.kind === 'text' ? { ...current, text } : current)} /> : item.kind === 'image' ? <div key={item.id} className={`canvas-image ${selectedId === item.id ? 'selected' : ''}`} style={{ left: item.x, top: item.y, width: item.width, height: item.height }} onPointerDown={e => { e.stopPropagation(); setSelectedId(item.id) }}><img src={item.src} alt={item.name} draggable={false} /><div className="canvas-image-handle" onPointerDown={e => beginDrag(e, item, 'move')}><span className="canvas-grip">⋮⋮</span><span>{item.name}</span></div>{selectedId === item.id && <button className="canvas-resize-handle" title="Resize picture" aria-label="Resize picture" onPointerDown={e => beginDrag(e, item, 'resize')}><Maximize2 size={11} /></button>}</div> : null })}
            <svg className="canvas-ink-layer" viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} style={{ pointerEvents: 'none' }}>{activeBoard.items.filter((item): item is CanvasStroke | CanvasShape => item.kind === 'stroke' || item.kind === 'shape').map(item => paintItem(preview?.id === item.id && (preview.kind === 'stroke' || preview.kind === 'shape') ? preview : item, item.id))}{draft && paintItem(draft, 'draft', true)}</svg>
          </div>{tool !== 'select' && tool !== 'eraser' && <div className="canvas-tool-overlay" />}
          </div>
        </div><div className="canvas-workspace-foot"><span>Infinite canvas · Scroll to pan · Ctrl/⌘ + scroll to zoom</span><span>Pen · shapes · text · notes · pictures</span></div><input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file && activeBoard) void addImage(file, activeBoard.id, visibleCenter()); e.target.value = '' }} /></> : <div className="card canvas-start"><span className="canvas-start-icon"><StickyNote size={30} /></span><h3>{activeCollection ? 'A fresh canvas is one click away' : 'Make room for your ideas'}</h3><p>{activeCollection ? 'Create a canvas inside this collection to start drawing, writing, and collecting pictures.' : 'Create a collection to organize your canvases, then add as many boards as you need.'}</p><button className="button primary" onClick={() => launchDialog(activeCollection ? 'newBoard' : 'newCollection')}><Plus size={16} /> {activeCollection ? 'New canvas' : 'New collection'}</button></div>}
    </section>
    {notice && <div className="canvas-notice">{notice}</div>}
    {dialog && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setDialog(null) }}><div className="modal canvas-name-modal" role="dialog" aria-modal="true" aria-label="Name canvas item"><div className="modal-head"><div><span className="eyebrow">CANVAS STUDIO</span><h2>{dialog.kind.includes('Collection') ? 'Collection name' : 'Canvas name'}</h2></div><MoreHorizontal size={20} /></div><div className="modal-body"><label className="field"><span>Name</span><input autoFocus maxLength={120} value={dialogName} onChange={e => setDialogName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveDialog() }} placeholder={dialog.kind.includes('Collection') ? 'e.g. Trading ideas' : 'e.g. Market structure'} /></label></div><div className="modal-foot"><button className="button ghost" onClick={() => setDialog(null)}>Cancel</button><button className="button primary" disabled={!dialogName.trim()} onClick={saveDialog}>Save</button></div></div></div>}
  </div>
}
