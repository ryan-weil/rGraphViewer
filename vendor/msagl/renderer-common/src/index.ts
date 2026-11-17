import {EdgeRoutingMode} from '@msagl/core'
import {TextMeasurerOptions} from '@msagl/drawing'

export {layoutGraph, layoutGraphOnWorker} from './layout'
export {default as TextMeasurer} from './text-measurer'
export {deepEqual, getLabelPosition} from './utils'
export {default as initLayoutWorker} from './workers/layoutWorker'

export type LayoutOptions = {
  layoutType?: 'Sugiyama LR' | 'Sugiyama TB' | 'Sugiyama BT' | 'Sugiyama RL' | 'IPsepCola' | 'MDS'
  label?: Partial<TextMeasurerOptions>
  edgeRoutingMode?: EdgeRoutingMode
  smoothCorners?: boolean
  /** Layered layouts: the least distance between neighboring layers. */
  layerSeparation?: number
  /** Layered layouts: the least distance between neighboring nodes of a layer. */
  nodeSeparation?: number
}
