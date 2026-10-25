export interface CameraPosition {
  x: number
  y: number
  scale: number
}

export const MIN_SCALE = 0.001
export const MAX_SCALE = 4
const ZOOM_RESPONSE_MS = 45

export function wheelZoomFactor(delta: number, mode: number, pageHeight: number): number {
  const pixels = delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1)
  return Math.exp(-Math.max(-240, Math.min(240, pixels)) * 0.0015)
}

/** Keeps wheel bursts continuous while preserving the graph point under the cursor. */
export class ZoomMotion {
  private target: number | null = null
  private anchorX = 0
  private anchorY = 0
  private worldX = 0
  private worldY = 0

  get active(): boolean { return this.target !== null }

  queue(camera: CameraPosition, factor: number, x: number, y: number) {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return
    // A reversal should respond immediately instead of finishing the old direction.
    const reversing = this.target !== null && Math.log(this.target / camera.scale) * Math.log(factor) < 0
    const start = reversing ? camera.scale : this.target ?? camera.scale
    this.target = Math.max(MIN_SCALE, Math.min(MAX_SCALE, start * factor))
    this.anchorX = x
    this.anchorY = y
    this.worldX = (x - camera.x) / camera.scale
    this.worldY = (y - camera.y) / camera.scale
  }

  advance(camera: CameraPosition, elapsedMs: number, reducedMotion = false) {
    if (this.target === null) return
    const remaining = Math.log(this.target / camera.scale)
    const blend = 1 - Math.exp(-Math.max(0, elapsedMs) / ZOOM_RESPONSE_MS)
    let scale = reducedMotion ? this.target : camera.scale * Math.exp(remaining * blend)
    if (Math.abs(Math.log(this.target / scale)) < 0.0005) {
      scale = this.target
      this.target = null
    }
    camera.x = this.anchorX - this.worldX * scale
    camera.y = this.anchorY - this.worldY * scale
    camera.scale = scale
  }

  cancel() { this.target = null }
}
