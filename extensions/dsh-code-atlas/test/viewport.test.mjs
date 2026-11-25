import test from 'node:test';
import assert from 'node:assert/strict';
import { fitCamera, zoomCamera } from '../lib/map-viewport.js';
import { NavigationHistory } from '../lib/navigation-history.js';
test('zoom keeps the same source point under the cursor and remains bounded', () => {
  const camera = { x: -75, y: 20, scale: 0.7 }, x = 220, y = 160;
  const next = zoomCamera(camera, 1.2, x, y);
  assert(Math.abs((x - next.x) / next.scale - (x - camera.x) / camera.scale) < 1e-8);
  assert(Math.abs((y - next.y) / next.scale - (y - camera.y) / camera.scale) < 1e-8);
  assert.equal(zoomCamera(camera, 100, x, y).scale, 3);
  assert.equal(zoomCamera(camera, 0.001, x, y).scale, 0.2);
  assert.equal(fitCamera(5000, 5000, 600, 400).scale, 0.55, 'huge graphs stay readable and pan instead of shrinking to tiny text');
});
test('history is bounded, replaces duplicate visits, and commits only successful destinations', () => {
  const history = new NavigationHistory((a, b) => a.id === b.id, 3);
  for (const id of ['a', 'b', 'c', 'd']) history.push({ id });
  assert.deepEqual(history.trail().map(item => item.id), ['b', 'c', 'd']);
  const candidate = history.target(-1); assert.equal(candidate.entry.id, 'c');
  assert.equal(history.trail().at(-1).id, 'd');
  history.commit(candidate.index); history.push({ id: 'e' });
  assert.equal(history.canForward, false); assert.deepEqual(history.trail().map(item => item.id), ['b', 'c', 'e']);
  history.push({ id: 'e', label: 'new label' }); assert.equal(history.trail().length, 3);
});
