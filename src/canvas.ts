import {Deck, OrthographicView, COORDINATE_SYSTEM} from '@deck.gl/core/typed'
import {PathLayer, PolygonLayer, TextLayer} from '@deck.gl/layers/typed'
import {GeomNode, Graph} from '@msagl/core'
import {CameraPosition, MIN_SCALE, ZoomMotion, wheelZoomFactor, originalWheelZoomFactor, zoomImmediately} from './camera'
import {ArrowItem, EdgeItem, NodeItem, ShadowItem, Scene, Theme, PALETTES, createScene, styleScene} from './scene'
import {exportSvg} from './svg-export'

function nodePath(item: NodeItem) { return item.path }
function nodeFill(item: NodeItem) { return item.fill }
function nodeStroke(item: NodeItem) { return item.stroke }
function nodeInk(item: NodeItem) { return item.ink }
function nodeWidth(item: NodeItem) { return item.width }
function nodeText(item: NodeItem) { return item.label }
function nodeLabelPosition(item: NodeItem) { return item.labelPosition }
function nodeFontSize(item: NodeItem) { return item.fontSize }
function edgePath(item: EdgeItem) { return item.path }
function edgeInk(item: EdgeItem) { return item.ink }
function edgeLabelInk(item: EdgeItem) { return item.labelInk }
function edgeWidth(item: EdgeItem) { return item.width }
function edgeText(item: EdgeItem) { return item.label }
function edgeLabelPosition(item: EdgeItem) { return item.labelPosition }
function edgeFontSize(item: EdgeItem) { return item.fontSize }
function arrowPath(item: ArrowItem) { return item.path }
function arrowInk(item: ArrowItem) { return item.edge.ink }
function shadowPath(item: ShadowItem) { return item.path }
function shadowInk(item: ShadowItem) { return item.ink }
function cursor() { return 'grab' }

function svgElement<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const element = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
  return element
}

export class GraphCanvas {
  private graph: Graph | null = null
  private scene: Scene | null = null
  private deck: Deck | null = null
  private camera: CameraPosition = {scale: 1, x: 0, y: 0}
  private zoomMotion = new ZoomMotion()
  private improvedScrolling = true
  private animationFrame = 0
  private frameTime = 0
  private animateFrame = this.onAnimationFrame.bind(this)
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  private pointer: {id: number; x: number; y: number; moved: boolean} | null = null
  private selected: string | null = null
  private minimapViewport: SVGRectElement | null = null
  private resizeObserver: ResizeObserver
  private renderError: Error | null = null

  constructor(private container: HTMLDivElement, private minimap: SVGSVGElement) {
    const surface = document.createElement('canvas')
    surface.setAttribute('aria-label', 'Graph rendered with WebGL')
    container.append(surface)
    const options: WebGLContextAttributes = {alpha: true, antialias: true, powerPreference: 'high-performance'}
    const gl = surface.getContext('webgl2', options) || surface.getContext('webgl', options)
    if (!gl) {
      this.renderError = new Error('WebGL could not start. Enable graphics acceleration in your browser and reload.')
      container.dataset.renderer = 'unavailable'
      return
    }
    container.dataset.renderer = gl instanceof WebGL2RenderingContext ? 'webgl2' : 'webgl'
    // Let Deck own drawing-buffer resizing, including display pixel density.
    this.deck = new Deck({canvas: surface, glOptions: options, width: '100%', height: '100%', controller: false,
      views: new OrthographicView({flipY: true}), viewState: {target: [0,0,0], zoom: 0},
      parameters: {depthTest: false}, getCursor: cursor,
      onLoad: this.requestFrame.bind(this), onError: this.onRenderError.bind(this),
    })
    container.addEventListener('wheel', this.onWheel.bind(this), {passive: false})
    container.addEventListener('pointerdown', this.onPointerDown.bind(this))
    container.addEventListener('pointermove', this.onPointerMove.bind(this))
    container.addEventListener('pointerup', this.onPointerUp.bind(this))
    container.addEventListener('pointercancel', this.onPointerCancel.bind(this))
    container.addEventListener('dblclick', this.onDoubleClick.bind(this))
    minimap.addEventListener('pointerdown', this.onMinimapClick.bind(this))
    this.resizeObserver = new ResizeObserver(this.requestFrame.bind(this))
    this.resizeObserver.observe(container)
  }

  render(graph: Graph) {
    if (this.renderError) throw this.renderError
    this.graph = graph
    this.scene = createScene(graph)
    this.selected = null
    this.refreshTheme()
    this.buildMinimap()
    this.fit()
  }

  refreshTheme() {
    if (!this.scene) return
    styleScene(this.scene, this.theme, this.selected)
    this.updateLayers()
  }

  private get theme(): Theme { return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light' }

  private updateLayers() {
    if (!this.deck || !this.scene) return
    const {nodes, edges, arrows, shadows} = this.scene
    const common = {coordinateSystem: COORDINATE_SYSTEM.CARTESIAN, parameters: {depthTest: false}}
    const text = {...common, fontFamily: 'Segoe UI, Arial, sans-serif', fontWeight: 500, lineHeight: 1.2,
      characterSet: 'auto' as const, sizeUnits: 'common' as const, billboard: true,
      fontSettings: {sdf: true, fontSize: 64, buffer: 8}, getTextAnchor: 'middle' as const, getAlignmentBaseline: 'center' as const}
    this.deck.setProps({layers: [
      new PathLayer<EdgeItem>({...common, id: 'edges', data: edges, getPath: edgePath, getColor: edgeInk,
        getWidth: edgeWidth, widthUnits: 'common', widthMinPixels: 0.6, jointRounded: true, capRounded: true, pickable: true}),
      new PolygonLayer<ArrowItem>({...common, id: 'arrows', data: arrows, getPolygon: arrowPath, getFillColor: arrowInk,
        stroked: false, pickable: true}),
      new TextLayer<EdgeItem>({...text, id: 'edge-labels', data: edges, getText: edgeText,
        getPosition: edgeLabelPosition, getSize: edgeFontSize, getColor: edgeLabelInk,
        outlineWidth: 0.2, outlineColor: [...PALETTES[this.theme].background]}),
      new PolygonLayer<ShadowItem>({...common, id: 'node-shadows', data: shadows, getPolygon: shadowPath,
        getFillColor: shadowInk, stroked: false}),
      new PolygonLayer<NodeItem>({...common, id: 'nodes', data: nodes, getPolygon: nodePath,
        getFillColor: nodeFill, stroked: false, pickable: true}),
      new PathLayer<NodeItem>({...common, id: 'node-outlines', data: nodes, getPath: nodePath,
        getColor: nodeStroke, getWidth: nodeWidth, widthUnits: 'common', widthMinPixels: 0.6, jointRounded: true}),
      new TextLayer<NodeItem>({...text, id: 'node-labels', data: nodes, getText: nodeText,
        getPosition: nodeLabelPosition, getSize: nodeFontSize, getColor: nodeInk}),
    ]})
  }

  fit() {
    if (!this.scene) return
    const box = this.container.getBoundingClientRect()
    const bounds = this.scene.bounds
    this.camera.scale = Math.max(MIN_SCALE, Math.min((box.width - 100) / bounds.width, (box.height - 100) / bounds.height, 1.4))
    this.centerOn(bounds.center.x, -bounds.center.y)
  }

  focusNode(id: string) {
    const node = this.graph?.findNodeRecursive(id)
    if (!node) return
    const geom = GeomNode.getGeom(node)
    this.camera.scale = Math.min(1.4, Math.max(0.6, 240 / geom.width))
    this.centerOn(geom.center.x, -geom.center.y)
  }

  zoom(factor: number, px?: number, py?: number) {
    const rect = this.container.getBoundingClientRect()
    const x = px ?? rect.width / 2
    const y = py ?? rect.height / 2
    if (this.improvedScrolling) {
      this.zoomMotion.queue(this.camera, factor, x, y)
      this.requestFrame()
    } else {
      zoomImmediately(this.camera, factor, x, y)
      this.updateCamera()
    }
  }

  get scrollingImprovements(): boolean { return this.improvedScrolling }

  setScrollingImprovements(enabled: boolean) {
    this.improvedScrolling = enabled
    // Stop at the currently displayed position when switching modes mid-gesture.
    this.zoomMotion.cancel()
  }

  resetZoom() {
    this.zoomMotion.cancel()
    this.zoom(1 / this.camera.scale)
  }

  select(id: string | null) {
    this.selected = id
    this.refreshTheme()
  }

  exportSvg(): string {
    if (!this.scene) throw new Error('Open a graph to export it.')
    return exportSvg(this.scene, this.theme)
  }

  private centerOn(x: number, y: number) {
    this.zoomMotion.cancel()
    const box = this.container.getBoundingClientRect()
    this.camera.x = box.width / 2 - x * this.camera.scale
    this.camera.y = box.height / 2 - y * this.camera.scale
    this.requestFrame()
  }

  private requestFrame() {
    if (this.animationFrame || !this.deck) return
    this.frameTime = performance.now()
    this.animationFrame = requestAnimationFrame(this.animateFrame)
  }

  private onAnimationFrame(time: number) {
    this.animationFrame = 0
    this.zoomMotion.advance(this.camera, time - this.frameTime, this.reducedMotion.matches)
    this.updateCamera()
    if (this.zoomMotion.active) {
      this.frameTime = time
      this.animationFrame = requestAnimationFrame(this.animateFrame)
    }
  }

  private updateCamera() {
    if (!this.deck) return
    const box = this.container.getBoundingClientRect()
    const {x, y, scale} = this.camera
    // Camera changes update projection uniforms; graph buffers and glyph atlases stay on the GPU.
    this.deck.setProps({viewState: {target: [(box.width / 2 - x) / scale, (box.height / 2 - y) / scale, 0], zoom: Math.log2(scale)}})
    this.container.dispatchEvent(new CustomEvent('camera-change', {detail: {scale}}))
    if (this.minimapViewport && this.scene) {
      const bounds = this.scene.bounds
      const left = Math.max(bounds.left - 15, -x / scale)
      const top = Math.max(-bounds.top - 15, -y / scale)
      const right = Math.min(bounds.right + 15, (box.width - x) / scale)
      const bottom = Math.min(-bounds.bottom + 15, (box.height - y) / scale)
      this.minimapViewport.setAttribute('x', String(left))
      this.minimapViewport.setAttribute('y', String(top))
      this.minimapViewport.setAttribute('width', String(Math.max(0, right - left)))
      this.minimapViewport.setAttribute('height', String(Math.max(0, bottom - top)))
    }
  }

  private buildMinimap() {
    this.minimap.replaceChildren()
    const bounds = this.scene.bounds
    this.minimap.setAttribute('viewBox', `${bounds.left - 20} ${-bounds.top - 20} ${bounds.width + 40} ${bounds.height + 40}`)
    for (const node of this.graph.nodesBreadthFirst) {
      const box = GeomNode.getGeom(node)?.boundingBox
      if (box) this.minimap.append(svgElement('rect', {x: box.left, y: -box.top, width: box.width, height: box.height, rx: 3, class: 'mini-node'}))
    }
    this.minimapViewport = svgElement('rect', {class: 'mini-viewport', 'vector-effect': 'non-scaling-stroke'})
    this.minimap.append(this.minimapViewport)
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault()
    const box = this.container.getBoundingClientRect()
    const factor = this.improvedScrolling
      ? wheelZoomFactor(event.deltaY, event.deltaMode, box.height)
      : originalWheelZoomFactor(event.deltaY)
    this.zoom(factor, event.clientX - box.left, event.clientY - box.top)
  }

  private onPointerDown(event: PointerEvent) {
    if (event.button !== 0 && event.button !== 1) return
    this.zoomMotion.cancel()
    this.pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false}
    this.container.setPointerCapture(event.pointerId)
  }

  private onPointerMove(event: PointerEvent) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return
    const dx = event.clientX - this.pointer.x
    const dy = event.clientY - this.pointer.y
    if (!this.pointer.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    this.pointer.moved = true
    this.container.classList.add('is-panning')
    this.camera.x += dx
    this.camera.y += dy
    this.pointer.x = event.clientX
    this.pointer.y = event.clientY
    if (this.improvedScrolling) this.requestFrame()
    else this.updateCamera()
  }

  private onPointerUp(event: PointerEvent) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return
    if (!this.pointer.moved) {
      const item = this.pick(event)
      this.container.dispatchEvent(new CustomEvent('graph-select', {detail: {
        nodeId: item?.kind === 'node' ? item.id : null, edge: item?.kind === 'edge' ? item.index : null,
      }}))
    }
    this.onPointerCancel()
    this.container.releasePointerCapture(event.pointerId)
  }

  private onPointerCancel() {
    this.pointer = null
    this.container.classList.remove('is-panning')
  }

  private pick(event: MouseEvent): NodeItem | EdgeItem | null {
    const box = this.container.getBoundingClientRect()
    return this.deck.pickObject({x: event.clientX - box.left, y: event.clientY - box.top, radius: 5})?.object ?? null
  }

  private onDoubleClick(event: MouseEvent) {
    const item = this.pick(event)
    if (item?.kind === 'node') this.focusNode(item.id)
    else {
      const box = this.container.getBoundingClientRect()
      this.zoom(1.5, event.clientX - box.left, event.clientY - box.top)
    }
  }

  private onMinimapClick(event: PointerEvent) {
    if (!this.scene) return
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(this.minimap.getScreenCTM().inverse())
    this.centerOn(point.x, point.y)
  }

  private onRenderError(error: Error) {
    this.renderError = error
    this.container.dispatchEvent(new CustomEvent('renderer-error', {detail: error.message}))
  }
}
