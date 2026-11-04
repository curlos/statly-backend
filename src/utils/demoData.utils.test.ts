import { test } from 'node:test';
import assert from 'node:assert';
import { getDemoDaysToShift } from './demoData.utils';

const newest = new Date('2026-01-03T14:40:00.000Z');

test('getDemoDaysToShift moves the newest record to the most recent day that keeps it in the past', () => {
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-11-01T15:00:00.000Z')), 302);
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-11-01T08:00:00.000Z')), 301);
});

test('getDemoDaysToShift only adds the days not shifted yet', () => {
	assert.strictEqual(getDemoDaysToShift(newest, 301, new Date('2026-11-01T15:00:00.000Z')), 1);
});

test('getDemoDaysToShift does nothing when the data is already current', () => {
	assert.strictEqual(getDemoDaysToShift(newest, 302, new Date('2026-11-01T15:00:00.000Z')), 0);
	assert.strictEqual(getDemoDaysToShift(newest, 302, new Date('2026-11-02T14:39:00.000Z')), 0);
});

test('getDemoDaysToShift never moves dates back', () => {
	assert.strictEqual(getDemoDaysToShift(newest, 400, new Date('2026-11-01T15:00:00.000Z')), 0);
});
