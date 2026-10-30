import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import { Button } from './ui';

type Crop = { zoom: number; x: number; y: number; transparent: boolean; color: string };
const INITIAL: Crop = { zoom: 1, x: 0, y: 0, transparent: true, color: '#20202a' };

/** Vorschau und Export verwenden denselben Ausschnitt; außerhalb des Kreises
 * bleiben die Pixel auch bei einem farbigen Hintergrund transparent. */
function draw(canvas: HTMLCanvasElement, image: HTMLImageElement, crop: Crop, size: number) {
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
  if (!crop.transparent) { ctx.fillStyle = crop.color; ctx.fillRect(0, 0, size, size); }
  const scale = size / Math.min(image.naturalWidth, image.naturalHeight) * crop.zoom;
  const w = image.naturalWidth * scale, h = image.naturalHeight * scale;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, (size - w) / 2 + crop.x * size, (size - h) / 2 + crop.y * size, w, h);
  ctx.restore();
}

export function AvatarCropper({ image, onApply, onCancel }: {
  image: HTMLImageElement; onApply: (data: string) => void; onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null);
  const [crop, setCrop] = useState<Crop>(INITIAL);
  const [preview, setPreview] = useState('');
  const zoom = (n: number) => setCrop(c => ({ ...c, zoom: Math.min(3, Math.max(.2, n)) }));
  useEffect(() => {
    if (!canvas.current) return;
    draw(canvas.current, image, crop, 256);
    const output = document.createElement('canvas');
    let data = '';
    // PNG erhält Transparenz. Seltene schwer komprimierbare Fotos werden etwas
    // kleiner exportiert, damit der private Profil-Speicher sie sicher annimmt.
    for (const size of [256, 192, 128]) {
      draw(output, image, crop, size); data = output.toDataURL('image/png');
      if (data.length <= 180000) break;
    }
    setPreview(data);
  }, [image, crop]);

  return <div className="avatar-cropper">
    <p className="text-sm text-ghg-muted">Bild im Kreis verschieben und mit dem Regler vergrößern oder verkleinern.</p>
    <div className="avatar-crop-stage">
      <canvas ref={canvas} className="avatar-crop-canvas avatar-checker" aria-label="Runder Bildausschnitt" tabIndex={0}
        onPointerDown={e => {
          if (drag.current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: crop.x, startY: crop.y };
        }}
        onPointerMove={e => {
          const d = drag.current; if (!d || d.id !== e.pointerId) return;
          const width = e.currentTarget.getBoundingClientRect().width;
          setCrop(c => ({ ...c, x: Math.max(-2, Math.min(2, d.startX + (e.clientX - d.x) / width)), y: Math.max(-2, Math.min(2, d.startY + (e.clientY - d.y) / width)) }));
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onKeyDown={e => {
          const move = { ArrowLeft: [-.02, 0], ArrowRight: [.02, 0], ArrowUp: [0, -.02], ArrowDown: [0, .02] }[e.key];
          if (move) { e.preventDefault(); setCrop(c => ({ ...c, x: c.x + move[0], y: c.y + move[1] })); }
        }} />
      <div className="avatar-small-preview"><span>Vorschau</span><div className="avatar-checker">{preview && <img src={preview} alt="Runde Profilbild-Vorschau" />}</div></div>
    </div>
    <div className="avatar-zoom">
      <button type="button" aria-label="Verkleinern" onClick={() => zoom(crop.zoom - .1)}><Minus size={18}/></button>
      <input aria-label="Bildzoom" type="range" min="0.2" max="3" step="0.01" value={crop.zoom} onChange={e => zoom(Number(e.target.value))}/>
      <button type="button" aria-label="Vergrößern" onClick={() => zoom(crop.zoom + .1)}><Plus size={18}/></button>
      <output>{Math.round(crop.zoom * 100)} %</output>
    </div>
    <fieldset className="avatar-background"><legend>Hintergrund</legend>
      <label><input type="radio" name="avatar-background" checked={crop.transparent} onChange={() => setCrop(c => ({ ...c, transparent: true }))}/>Transparent</label>
      <label><input type="radio" name="avatar-background" checked={!crop.transparent} onChange={() => setCrop(c => ({ ...c, transparent: false }))}/>Farbe</label>
      <input type="color" aria-label="Hintergrundfarbe" value={crop.color} onChange={e => setCrop(c => ({ ...c, color: e.target.value, transparent: false }))}/>
    </fieldset>
    <div className="avatar-crop-footer"><button type="button" className="avatar-reset" onClick={() => setCrop(INITIAL)}><RotateCcw size={15}/>Zurücksetzen</button>
      <div className="flex gap-2"><Button variant="ghost" onClick={onCancel}>Abbrechen</Button><Button disabled={!preview} onClick={() => onApply(preview)}>Übernehmen</Button></div>
    </div>
  </div>;
}
