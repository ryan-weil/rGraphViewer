import './styles.css'
import {Edge, Graph, Node} from '@msagl/core'
import {DrawingEdge} from '@msagl/drawing'
import {layoutGraphOnWorker, TextMeasurer} from '@msagl/renderer-common'
import {GraphCanvas} from './canvas'
import {LAYOUT, parseSource, prepareGeometry, labelOf, firstLine, errorMessage} from './graph'

function element<T extends Element = HTMLElement>(id: string): T {
  return document.getElementById(id) as unknown as T
}

function html<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text != null) node.textContent = text
  return node
}

function icon(name: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('class', 'icon')
  const use = document.createElementNS(svg.namespaceURI, 'use')
  use.setAttribute('href', `#i-${name}`)
  svg.append(use)
  return svg
}

const canvas = new GraphCanvas(element<HTMLDivElement>('graph-canvas'), element<SVGSVGElement>('minimap'))
const measurer = new TextMeasurer(LAYOUT.label)
const search = element<HTMLInputElement>('node-search')
const fileInput = element<HTMLInputElement>('file-input')
const openDialog = element<HTMLDialogElement>('open-dialog')
const sourceDialog = element<HTMLDialogElement>('source-dialog')
const helpDialog = element<HTMLDialogElement>('help-dialog')
const state: {graph: Graph | null; nodes: Node[]; edges: Edge[]; source: string; name: string; selected: string | null; busy: boolean; listLimit: number} = {
  graph: null, nodes: [], edges: [], source: '', name: 'graph.dot', selected: null, busy: false, listLimit: 100,
}
let dragDepth = 0

document.addEventListener('click', onDocumentClick)
document.addEventListener('keydown', onKeyboard)
document.addEventListener('dragenter', onDragEnter)
document.addEventListener('dragleave', onDragLeave)
document.addEventListener('dragover', onDragOver)
document.addEventListener('drop', onDrop)
fileInput.addEventListener('change', onFileChange)
search.addEventListener('input', onSearch)
search.addEventListener('keydown', onSearchKey)
element('graph-canvas').addEventListener('camera-change', onCameraChange)
element('graph-canvas').addEventListener('graph-select', onCanvasSelect)
element('graph-canvas').addEventListener('renderer-error', onRendererError)
element('graph-url').addEventListener('keydown', onUrlKey)
element('source-editor').addEventListener('keydown', onEditorKey)
element('paste-source').addEventListener('keydown', onEditorKey)
setTheme(readTheme())
initialize()

function readTheme(): string {
  try {
    const saved = localStorage.getItem('rGraphViewer.theme')
    if (saved === 'light' || saved === 'dark') return saved
  } catch {}
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function setTheme(theme: string) {
  document.documentElement.dataset.theme = theme
  element('theme-icon').setAttribute('href', theme === 'dark' ? '#i-sun' : '#i-moon')
  element('theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`)
  document.querySelector('meta[name="theme-color"]').setAttribute('content', theme === 'dark' ? '#171c28' : '#f7f8fc')
  try { localStorage.setItem('rGraphViewer.theme', theme) } catch {}
  canvas.refreshTheme()
}

function onRendererError(event: Event) { showError(`WebGL rendering failed: ${(event as CustomEvent).detail}`) }

async function initialize() {
  const params = new URLSearchParams(location.search)
  const url = params.get('url') || './samples/control-flow.dot'
  await loadGraph(readUrl(url), nameFromUrl(url), params.has('url') ? 'From URL' : 'Example graph')
  const selected = params.get('node')
  if (selected && state.graph?.findNodeRecursive(selected)) selectNode(selected, true)
}

function nameFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()) || 'graph.dot'
  } catch { return 'graph.dot' }
}

async function readUrl(url: string): Promise<string> {
  const target = new URL(url, location.href)
  if (!['https:', 'http:'].includes(target.protocol)) throw new Error('Use an HTTP or HTTPS link to your graph.')
  const controller = new AbortController()
  const timeout = setTimeout(abortFetch, 20000, controller)
  try {
    const response = await fetch(target, {signal: controller.signal})
    if (!response.ok) throw new Error(`The graph could not be loaded (HTTP ${response.status}). Check the direct file URL.`)
    return await response.text()
  } finally { clearTimeout(timeout) }
}

function abortFetch(controller: AbortController) { controller.abort() }

async function loadGraph(content: string | Promise<string>, name: string, origin: string) {
  if (state.busy) return
  setBusy(true)
  clearErrors()
  let success = false
  try {
    const source = await content
    const graph = parseSource(source, name)
    prepareGeometry(graph, measurer.measure)
    const laidOut = await layoutGraphOnWorker('./worker.js', graph, LAYOUT, true)
    state.graph = laidOut
    state.nodes = Array.from(laidOut.nodesBreadthFirst)
    state.edges = Array.from(laidOut.deepEdges)
    state.source = source
    state.name = name
    state.selected = null
    state.listLimit = 100
    search.value = ''
    element('inspector').hidden = true
    element('graph-name').textContent = name
    element('graph-name').title = name
    element('header-file').textContent = name
    element('graph-origin').textContent = origin
    element('file-kind').textContent = name.toLowerCase().endsWith('.json') ? 'JSON' : 'DOT'
    element('node-count').textContent = state.nodes.length.toLocaleString()
    element('edge-count').textContent = state.edges.length.toLocaleString()
    document.title = `${name} · rGraphViewer`
    canvas.render(laidOut)
    renderNodeList()
    closeDialogs()
    success = true
  } catch (error) {
    showError(errorMessage(error))
  } finally {
    setBusy(false)
    setStatus(success ? 'Ready to explore' : 'Could not open graph')
  }
}

function setBusy(busy: boolean) {
  state.busy = busy
  element('loading').hidden = !busy
  element('status-dot').classList.toggle('busy', busy)
  element('canvas-area').setAttribute('aria-busy', String(busy))
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-load]')) button.disabled = busy
  if (busy) setStatus('Arranging graph…')
}

function setStatus(message: string) { element('status-text').textContent = message }

function clearErrors() {
  element('open-error').hidden = true
  element('source-error').hidden = true
  element('toast').hidden = true
}

function showError(message: string) {
  const content = message.slice(0, 600)
  const target = sourceDialog.open ? element('source-error') : openDialog.open ? element('open-error') : null
  if (target) {
    target.textContent = content
    target.hidden = false
  } else toast(content, true)
}

function toast(message: string, error = false) {
  element('toast-text').textContent = message
  element('toast').classList.toggle('error', error)
  element('toast').hidden = false
}

function renderNodeList() {
  const query = search.value.trim().toLowerCase()
  const list = element('node-list')
  const fragment = document.createDocumentFragment()
  let matches = 0
  for (const node of state.nodes) {
    const label = labelOf(node)
    if (query && !`${node.id} ${label}`.toLowerCase().includes(query)) continue
    matches++
    if (matches > state.listLimit) continue
    const row = html('button', `node-row${state.selected === node.id ? ' is-active' : ''}`)
    row.dataset.node = node.id
    row.setAttribute('aria-pressed', String(state.selected === node.id))
    row.title = label
    const copy = html('span', 'node-row-copy')
    copy.append(html('span', 'node-row-title', firstLine(label)), html('span', 'node-row-meta', label.split('\n')[1] || node.id))
    row.append(html('span', 'node-dot'), copy, icon('chevron'))
    fragment.append(row)
  }
  element('result-count').textContent = matches.toLocaleString()
  if (matches === 0) fragment.append(html('p', 'list-empty', query ? 'No matching nodes. Try a name, ID, or address.' : 'Open a graph to explore its nodes.'))
  if (matches > state.listLimit) {
    const more = html('button', 'list-more', `Show more · ${matches - state.listLimit} remaining`)
    more.dataset.action = 'more-nodes'
    fragment.append(more)
  }
  list.replaceChildren(fragment)
}

function onSearch() { state.listLimit = 100; renderNodeList() }

function onSearchKey(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    const first = element('node-list').querySelector<HTMLButtonElement>('[data-node]')
    if (first) selectNode(first.dataset.node, true)
  }
  if (event.key === 'ArrowDown') element('node-list').querySelector<HTMLButtonElement>('button')?.focus()
}

function selectNode(id: string, focus = false) {
  const node = state.graph?.findNodeRecursive(id)
  if (!node) return
  state.selected = id
  element('inspector').hidden = false
  element('selection-kind').textContent = 'NODE DETAILS'
  const content = element('selection-details')
  const label = labelOf(node)
  const title = html('h2', 'selection-title', firstLine(label))
  const identity = html('span', 'selection-id', node.id)
  const fields = html('dl', 'detail-fields')
  for (const line of label.split('\n').slice(1)) {
    const colon = line.indexOf(':')
    addDetail(fields, colon >= 0 ? line.slice(0, colon) : 'Label', colon >= 0 ? line.slice(colon + 1).trim() : line)
  }
  const actions = html('div', 'detail-actions')
  const focusButton = html('button', 'button', 'Focus node')
  focusButton.dataset.action = 'focus-selection'
  focusButton.prepend(icon('fit'))
  const copyButton = html('button', 'button', 'Copy')
  copyButton.dataset.action = 'copy-selection'
  copyButton.prepend(icon('copy'))
  actions.append(focusButton, copyButton)
  content.replaceChildren(title, identity, fields, actions)
  addConnections(content, node, 'incoming')
  addConnections(content, node, 'outgoing')
  canvas.select(id)
  renderNodeList()
  if (focus) requestAnimationFrame(focusSelectedNode)
  if (matchMedia('(max-width: 760px)').matches) element('sidebar').classList.remove('is-open')
}

function addDetail(fields: HTMLDListElement, name: string, value: string) {
  const pair = html('div', '')
  pair.append(html('dt', '', name), html('dd', '', value))
  fields.append(pair)
}

function addConnections(container: HTMLElement, node: Node, direction: 'incoming' | 'outgoing') {
  const edges = direction === 'incoming' ? Array.from(node.inEdges) : Array.from(node.outEdges)
  const section = html('section', 'connections')
  section.append(html('h3', '', `${direction === 'incoming' ? 'INCOMING' : 'OUTGOING'} · ${edges.length}`))
  if (!edges.length) section.append(html('p', 'empty-connections', `No ${direction} connections`))
  for (const edge of edges) {
    const target = direction === 'incoming' ? edge.source : edge.target
    const drawing = DrawingEdge.getDrawingObj(edge) as DrawingEdge
    const button = html('button', 'connection-row')
    button.dataset.node = target.id
    const copy = html('span', 'connection-copy')
    copy.append(html('strong', '', firstLine(labelOf(target))), html('span', '', drawing?.labelText?.replace(/\n/g, ' · ') || target.id))
    button.append(icon('arrow'), copy, icon('chevron'))
    section.append(button)
  }
  container.append(section)
}

function selectEdge(index: number) {
  const edge = state.edges[index]
  if (!edge) return
  state.selected = null
  canvas.select(null)
  element('inspector').hidden = false
  element('selection-kind').textContent = 'EDGE DETAILS'
  const drawing = DrawingEdge.getDrawingObj(edge) as DrawingEdge
  const content = element('selection-details')
  const fields = html('dl', 'detail-fields')
  addDetail(fields, 'Label', drawing?.labelText || 'Unlabeled connection')
  content.replaceChildren(html('h2', 'selection-title', 'Connection'), html('span', 'selection-id', `${edge.source.id} → ${edge.target.id}`), fields)
  for (const node of [edge.source, edge.target]) {
    const row = html('button', 'connection-row')
    row.dataset.node = node.id
    row.append(icon('nodes'), html('span', 'connection-copy', firstLine(labelOf(node))), icon('chevron'))
    content.append(row)
  }
  renderNodeList()
}

function clearSelection() {
  state.selected = null
  element('inspector').hidden = true
  canvas.select(null)
  renderNodeList()
}

function focusSelectedNode() { if (state.selected) canvas.focusNode(state.selected) }

function onCanvasSelect(event: Event) {
  const detail = (event as CustomEvent).detail
  if (detail.nodeId) selectNode(detail.nodeId)
  else if (detail.edge != null) selectEdge(Number(detail.edge))
  else clearSelection()
}

function onCameraChange(event: Event) {
  const scale = (event as CustomEvent).detail.scale
  const label = `${scale < 0.1 ? (scale * 100).toFixed(1) : Math.round(scale * 100)}%`
  const value = element('zoom-value')
  if (value.textContent !== label) value.textContent = label
}

function showOpenDialog() {
  clearErrors()
  openDialog.showModal()
}

function closeDialogs() { openDialog.close(); sourceDialog.close(); helpDialog.close() }

function setOpenTab(tab: string) {
  for (const button of openDialog.querySelectorAll<HTMLButtonElement>('[data-tab]')) button.setAttribute('aria-selected', String(button.dataset.tab === tab))
  for (const panel of openDialog.querySelectorAll<HTMLElement>('[data-tab-panel]')) panel.hidden = panel.dataset.tabPanel !== tab
  element('open-error').hidden = true
  if (tab === 'paste') element<HTMLTextAreaElement>('paste-source').focus()
  if (tab === 'url') element<HTMLInputElement>('graph-url').focus()
}

async function onDocumentClick(event: MouseEvent) {
  const target = event.target as Element
  const node = target.closest<HTMLElement>('[data-node]')
  if (node && !node.closest('#graph-canvas')) { selectNode(node.dataset.node, true); return }
  const tab = target.closest<HTMLElement>('[data-tab]')
  if (tab) { setOpenTab(tab.dataset.tab); return }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action
  switch (action) {
    case 'theme': setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); break
    case 'open': showOpenDialog(); break
    case 'close-dialog': closeDialogs(); break
    case 'choose-file': fileInput.click(); break
    case 'demo': if (!state.busy) await loadGraph(readUrl('./samples/control-flow.dot'), 'control-flow.dot', 'Example graph'); break
    case 'load-paste': await loadGraph(element<HTMLTextAreaElement>('paste-source').value, 'untitled.dot', 'Pasted source'); break
    case 'load-url': await loadUrlInput(); break
    case 'source':
      element<HTMLTextAreaElement>('source-editor').value = state.source
      element('source-name').textContent = state.name
      clearErrors()
      sourceDialog.showModal()
      break
    case 'apply-source': await loadGraph(element<HTMLTextAreaElement>('source-editor').value, state.name, 'Edited source'); break
    case 'download-source': download(state.source, state.name, 'text/plain'); break
    case 'export': if (state.graph) download(canvas.exportSvg(), state.name.replace(/\.[^.]+$/, '') + '.svg', 'image/svg+xml'); break
    case 'fit': canvas.fit(); break
    case 'zoom-in': canvas.zoom(1.3); break
    case 'zoom-out': canvas.zoom(1 / 1.3); break
    case 'actual-size': canvas.resetZoom(); break
    case 'clear-selection': clearSelection(); break
    case 'focus-selection': focusSelectedNode(); break
    case 'copy-selection': await copySelection(); break
    case 'more-nodes': state.listLimit += 100; renderNodeList(); break
    case 'sidebar': element('sidebar').classList.toggle('is-open'); break
    case 'help': helpDialog.showModal(); break
    case 'dismiss-toast': element('toast').hidden = true; break
  }
}

async function copySelection() {
  const node = state.graph?.findNodeRecursive(state.selected)
  if (!node) return
  try {
    await navigator.clipboard.writeText(labelOf(node))
    toast('Node details copied.')
  } catch { toast('Clipboard access is unavailable. You can select and copy the details in the panel.', true) }
}

function download(content: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], {type}))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name.replace(/[<>:"/\\|?*]/g, '_')
  anchor.click()
  setTimeout(revokeDownload, 1000, url)
}

function revokeDownload(url: string) { URL.revokeObjectURL(url) }

function onFileChange() {
  const file = fileInput.files?.[0]
  if (file && !state.busy) loadGraph(file.text(), file.name, 'Local file')
  fileInput.value = ''
}

async function loadUrlInput() {
  if (state.busy) return
  const url = element<HTMLInputElement>('graph-url').value.trim()
  if (!url) { showError('Enter a direct link to a graph file.'); return }
  await loadGraph(readUrl(url), nameFromUrl(url), 'From URL')
}

function onUrlKey(event: KeyboardEvent) { if (event.key === 'Enter') loadUrlInput() }

function onEditorKey(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    event.preventDefault()
    const textarea = event.target as HTMLTextAreaElement
    textarea.setRangeText('  ', textarea.selectionStart, textarea.selectionEnd, 'end')
  }
}

function onKeyboard(event: KeyboardEvent) {
  const target = event.target as HTMLElement
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'o') {
    event.preventDefault()
    if (!state.busy) showOpenDialog()
    return
  }
  if (target.matches('input,textarea,[contenteditable=true]')) return
  if (openDialog.open || sourceDialog.open || helpDialog.open) return
  if (event.key === '/') {
    event.preventDefault()
    element('sidebar').classList.add('is-open')
    search.focus()
  } else if (event.key.toLowerCase() === 'f') canvas.fit()
  else if (event.key === '+' || event.key === '=') canvas.zoom(1.3)
  else if (event.key === '-') canvas.zoom(1 / 1.3)
  else if (event.key === 'Escape') {
    clearSelection()
    element('sidebar').classList.remove('is-open')
    element('toast').hidden = true
  }
}

function onDragEnter(event: DragEvent) {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  dragDepth++
  if (!state.busy) element('drop-overlay').hidden = false
}

function onDragLeave(event: DragEvent) {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (!dragDepth) element('drop-overlay').hidden = true
}

function onDragOver(event: DragEvent) {
  if (event.dataTransfer?.types.includes('Files')) {
    event.preventDefault()
    event.dataTransfer.dropEffect = state.busy ? 'none' : 'copy'
  }
}

function onDrop(event: DragEvent) {
  event.preventDefault()
  dragDepth = 0
  element('drop-overlay').hidden = true
  const file = event.dataTransfer?.files[0]
  if (file && !state.busy) loadGraph(file.text(), file.name, 'Local file')
}
