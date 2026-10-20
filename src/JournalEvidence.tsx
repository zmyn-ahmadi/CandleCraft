import { useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { Trade } from './model'

const safeEvidence = (value?: string) => value && /^data:image\/(png|jpeg|webp|gif);base64,/.test(value) ? value : undefined

export default function JournalEvidence({ trade, onEvidence }: { trade: Trade; onEvidence: (stage: 'before' | 'after', value?: string) => void }) {
  const [error, setError] = useState('')
  function add(file: File, stage: 'before' | 'after') {
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) { setError('Choose a PNG, JPEG, WebP, or GIF image'); return }
    if (file.size > 1_000_000) { setError('Image must be under 1 MB'); return }
    const reader = new FileReader()
    reader.onerror = () => setError('Could not read image')
    reader.onload = () => { if (typeof reader.result === 'string') { onEvidence(stage, reader.result); setError('') } }
    reader.readAsDataURL(file)
  }
  return <div className="journal-section"><div className="journal-section-heading"><span className="section-number">04</span><div><h3>Chart evidence</h3><p>Keep the setup and outcome beside your notes.</p></div></div><div className="evidence-grid">{(['before', 'after'] as const).map(stage => { const image = safeEvidence(trade.evidence?.[stage]); return <div className="evidence-card" key={stage}><strong>{stage === 'before' ? 'Before entry' : 'After exit'}</strong>{image ? <><a href={image} target="_blank" rel="noreferrer" title={`Open ${stage} image`}><img src={image} alt={`${stage === 'before' ? 'Before entry' : 'After exit'} chart for ${trade.symbol}`} /></a><button className="evidence-remove" onClick={() => onEvidence(stage, undefined)}><X size={13} /> Remove</button></> : <label className="evidence-upload"><ImagePlus size={19} /><span>Add screenshot</span><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event => { const file = event.target.files?.[0]; if (file) add(file, stage); event.target.value = '' }} /></label>}</div> })}</div>{error && <p className="import-error">{error}</p>}<p className="form-help">Images are stored inside this workspace and included in JSON exports. Maximum 1 MB per image.</p></div>
}
