import assert from 'node:assert/strict';
import test from 'node:test';
import { sixPmNewYork } from '../src/shop-time.js';

test('6 PM cutoff uses New York time in winter and summer', () => {
  assert.equal(sixPmNewYork(new Date('2026-11-10T13:00:00Z')).toISOString(), '2026-11-10T23:00:00.000Z'); // 8 AM EST
  assert.equal(sixPmNewYork(new Date('2026-07-15T12:00:00Z')).toISOString(), '2026-07-15T22:00:00.000Z'); // 8 AM EDT
});
