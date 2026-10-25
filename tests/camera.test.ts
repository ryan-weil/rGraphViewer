import test from 'node:test'
import assert from 'node:assert/strict'
import {CameraPosition, MAX_SCALE, MIN_SCALE, ZoomMotion, wheelZoomFactor} from '../src/camera'

function assertNear(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} differs from ${expected}`)
}

function finish(motion: ZoomMotion, camera: CameraPosition) {
  for (let i = 0; i < 100 && motion.active; i++) motion.advance(camera, 16)
  assert.equal(motion.active, false)
}

function cursorAnchorAndBurst() {
  const camera = {x: -90, y: 37, scale: 0.3}
  const motion = new ZoomMotion()
  const worldX = (400 - camera.x) / camera.scale
  const worldY = (200 - camera.y) / camera.scale
  motion.queue(camera, 1.2, 400, 200)
  motion.queue(camera, 1.2, 400, 200)
  assert.equal(camera.scale, 0.3) // Input is queued until the next display frame.
  motion.advance(camera, 16)
  assert.ok(camera.scale > 0.3 && camera.scale < 0.3 * 1.2 * 1.2)
  assertNear(worldX * camera.scale + camera.x, 400)
  assertNear(worldY * camera.scale + camera.y, 200)
  finish(motion, camera)
  assertNear(camera.scale, 0.3 * 1.2 * 1.2)
  assertNear(worldX * camera.scale + camera.x, 400)
  assertNear(worldY * camera.scale + camera.y, 200)
}

function reverseDuringZoom() {
  const camera = {x: 0, y: 0, scale: 1}
  const motion = new ZoomMotion()
  motion.queue(camera, 2, 100, 100)
  motion.advance(camera, 16)
  const atReversal = camera.scale
  motion.queue(camera, 0.9, 100, 100)
  motion.advance(camera, 16)
  assert.ok(camera.scale < atReversal)
  finish(motion, camera)
  assertNear(camera.scale, atReversal * 0.9)
}

function moveCursorDuringZoom() {
  const camera = {x: 0, y: 0, scale: 1}
  const motion = new ZoomMotion()
  motion.queue(camera, 1.2, 100, 100)
  motion.advance(camera, 16)
  const worldX = (350 - camera.x) / camera.scale
  const worldY = (220 - camera.y) / camera.scale
  motion.queue(camera, 1.2, 350, 220)
  finish(motion, camera)
  assertNear(camera.scale, 1.2 * 1.2)
  assertNear(worldX * camera.scale + camera.x, 350)
  assertNear(worldY * camera.scale + camera.y, 220)
}

function frameRateIndependent() {
  const cameraA = {x: 0, y: 0, scale: 1}
  const cameraB = {...cameraA}
  const motionA = new ZoomMotion()
  const motionB = new ZoomMotion()
  motionA.queue(cameraA, 1.5, 90, 80)
  motionB.queue(cameraB, 1.5, 90, 80)
  motionA.advance(cameraA, 32)
  motionB.advance(cameraB, 16)
  motionB.advance(cameraB, 16)
  assertNear(cameraA.scale, cameraB.scale)
  assertNear(cameraA.x, cameraB.x)
  assertNear(cameraA.y, cameraB.y)
}

function boundsAndInterruptions() {
  const camera = {x: 0, y: 0, scale: 1}
  const motion = new ZoomMotion()
  motion.queue(camera, 100, 100, 100)
  motion.advance(camera, 0, true)
  assert.equal(camera.scale, MAX_SCALE)
  assert.equal(motion.active, false)
  motion.queue(camera, 0.00001, 100, 100)
  finish(motion, camera)
  assert.equal(camera.scale, MIN_SCALE)
  motion.queue(camera, 1.2, 100, 100)
  motion.cancel()
  motion.advance(camera, 200)
  assert.equal(camera.scale, MIN_SCALE)
}

function wheelUnits() {
  assertNear(wheelZoomFactor(48, 0, 800), wheelZoomFactor(3, 1, 800))
  assertNear(wheelZoomFactor(200, 0, 800), wheelZoomFactor(0.25, 2, 800))
  assertNear(wheelZoomFactor(-120, 0, 800) * wheelZoomFactor(120, 0, 800), 1)
  assert.ok(wheelZoomFactor(-120, 0, 800) < 1.21)
}

test('wheel bursts animate without moving the point under the cursor', cursorAnchorAndBurst)
test('reversing the wheel immediately reverses zoom', reverseDuringZoom)
test('moving the cursor mid-zoom preserves the new anchor', moveCursorDuringZoom)
test('zoom progression depends on elapsed time, not frame count', frameRateIndependent)
test('zoom respects bounds, reduced motion, and interrupted gestures', boundsAndInterruptions)
test('pixel, line, and page wheel units produce consistent zoom', wheelUnits)
