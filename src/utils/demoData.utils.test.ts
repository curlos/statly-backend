import { test } from 'node:test';
import assert from 'node:assert';
import { getDemoDaysToShift } from './demoData.utils';

// Saturday January 3rd, 9:40am Eastern
const newest = new Date('2026-01-03T14:40:00.000Z');

test("getDemoDaysToShift moves the newest day to today in Eastern time, even before that day's records happen", () => {
	// November 1st at 3am and 10am Eastern
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-11-01T08:00:00.000Z')), 302);
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-11-01T15:00:00.000Z')), 302);
});

test('getDemoDaysToShift turns the day over at midnight Eastern, not UTC', () => {
	// October 31st at 11pm Eastern is still the day before
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-11-01T03:00:00.000Z')), 301);
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-11-02T04:59:00.000Z')), 302);
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-11-02T05:00:00.000Z')), 303);
});

test('getDemoDaysToShift follows midnight Eastern across the change to daylight saving time', () => {
	// Midnight is 5am UTC before March 8th and 4am UTC after it
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-03-08T04:59:00.000Z')), 63);
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-03-08T05:00:00.000Z')), 64);
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-03-09T03:59:00.000Z')), 64);
	assert.strictEqual(getDemoDaysToShift(newest, 0, new Date('2026-03-09T04:00:00.000Z')), 65);
});

test('getDemoDaysToShift only adds the days not shifted yet', () => {
	assert.strictEqual(getDemoDaysToShift(newest, 301, new Date('2026-11-01T15:00:00.000Z')), 1);
});

test('getDemoDaysToShift does nothing when the data is already current', () => {
	assert.strictEqual(getDemoDaysToShift(newest, 302, new Date('2026-11-01T08:00:00.000Z')), 0);
	assert.strictEqual(getDemoDaysToShift(newest, 302, new Date('2026-11-02T04:59:00.000Z')), 0);
});

test('getDemoDaysToShift never moves dates back', () => {
	assert.strictEqual(getDemoDaysToShift(newest, 400, new Date('2026-11-01T15:00:00.000Z')), 0);
});
