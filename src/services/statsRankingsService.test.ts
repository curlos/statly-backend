import { describe, test } from 'node:test';
import assert from 'node:assert';
import { rankIntervals } from './statsRankingsService';

describe('rankIntervals', () => {
	const days = [
		{ date: '2024-01-01', count: 9 },
		{ date: '2024-01-02', count: 7 },
		{ date: '2024-01-03', count: 6 },
		{ date: '2024-01-04', count: 14 },
		{ date: '2024-01-05', count: 7 },
	];

	test('sorts by value, most first, with ranks', () => {
		const { rankings } = rankIntervals(days, 'count', 1, 10);
		assert.deepStrictEqual(
			rankings.map((r) => [r.rank, r.date, r.count]),
			[
				[1, '2024-01-04', 14],
				[2, '2024-01-01', 9],
				[3, '2024-01-05', 7],
				[4, '2024-01-02', 7],
				[5, '2024-01-03', 6],
			]
		);
	});

	test('breaks ties with the more recent interval for every label format', () => {
		const weeks = [
			{ date: 'January 01, 2024', count: 3 },
			{ date: 'January 08, 2024', count: 3 },
		];
		const months = [
			{ date: 'January 2024', count: 3 },
			{ date: 'March 2024', count: 3 },
		];
		const years = [
			{ date: '2023', count: 3 },
			{ date: '2024', count: 3 },
		];
		assert.strictEqual(rankIntervals(weeks, 'count', 1, 10).rankings[0].date, 'January 08, 2024');
		assert.strictEqual(rankIntervals(months, 'count', 1, 10).rankings[0].date, 'March 2024');
		assert.strictEqual(rankIntervals(years, 'count', 1, 10).rankings[0].date, '2024');
	});

	test('ranks by duration for focus', () => {
		const focusDays = [
			{ date: '2024-01-01', count: 5, duration: 3600 },
			{ date: '2024-01-02', count: 1, duration: 7200 },
		];
		const { rankings } = rankIntervals(focusDays, 'duration', 1, 10);
		assert.deepStrictEqual(
			rankings.map((r) => r.date),
			['2024-01-02', '2024-01-01']
		);
		assert.strictEqual(rankings[0].count, 1);
	});

	test('breaks focus time ties by focus record count, flipping with the sort', () => {
		const tiedDays = [
			{ date: '2024-01-03', count: 2, duration: 36000 },
			{ date: '2024-01-01', count: 5, duration: 36000 },
			{ date: '2024-01-02', count: 3, duration: 36000 },
		];
		assert.deepStrictEqual(
			rankIntervals(tiedDays, 'duration', 1, 10).rankings.map((r) => r.count),
			[5, 3, 2]
		);
		assert.deepStrictEqual(
			rankIntervals(tiedDays, 'duration', 1, 10, 'least').rankings.map((r) => r.count),
			[2, 3, 5]
		);
	});

	test('treats focus times within the same minute as tied', () => {
		const days = [
			{ date: '2021-02-28', count: 5, duration: 36040 }, // 10h 0m 40s
			{ date: '2026-04-26', count: 12, duration: 36005 }, // 10h 0m 5s
			{ date: '2024-01-01', count: 1, duration: 36060 }, // 10h 1m
		];
		assert.deepStrictEqual(
			rankIntervals(days, 'duration', 1, 10).rankings.map((r) => r.date),
			['2024-01-01', '2026-04-26', '2021-02-28']
		);
	});

	test('falls back to the more recent interval when focus time and record count both tie', () => {
		const tiedDays = [
			{ date: '2024-01-01', count: 3, duration: 36000 },
			{ date: '2024-01-05', count: 3, duration: 36000 },
			{ date: '2024-01-02', count: 4, duration: 3600 },
		];
		assert.deepStrictEqual(
			rankIntervals(tiedDays, 'duration', 1, 10).rankings.map((r) => r.date),
			['2024-01-05', '2024-01-01', '2024-01-02']
		);
		assert.deepStrictEqual(
			rankIntervals(tiedDays, 'duration', 1, 10, 'least').rankings.map((r) => r.date),
			['2024-01-02', '2024-01-05', '2024-01-01']
		);
	});

	test('paginates with absolute ranks and total pages', () => {
		const result = rankIntervals(days, 'count', 2, 2);
		assert.deepStrictEqual(
			result.rankings.map((r) => [r.rank, r.date]),
			[
				[3, '2024-01-05'],
				[4, '2024-01-02'],
			]
		);
		assert.strictEqual(result.totalPages, 3);
		assert.strictEqual(result.totalItems, 5);
		assert.strictEqual(result.page, 2);
	});

	test('returns an empty page past the end', () => {
		const result = rankIntervals(days, 'count', 10, 2);
		assert.deepStrictEqual(result.rankings, []);
		assert.strictEqual(result.totalPages, 3);
	});

	test('sorts least first when asked, ties still going to the more recent interval', () => {
		const { rankings } = rankIntervals(days, 'count', 1, 10, 'least');
		assert.deepStrictEqual(
			rankings.map((r) => [r.rank, r.date, r.count]),
			[
				[1, '2024-01-03', 6],
				[2, '2024-01-05', 7],
				[3, '2024-01-02', 7],
				[4, '2024-01-01', 9],
				[5, '2024-01-04', 14],
			]
		);
	});

	test('paginates least first', () => {
		const result = rankIntervals(days, 'count', 3, 2, 'least');
		assert.deepStrictEqual(
			result.rankings.map((r) => [r.rank, r.date]),
			[[5, '2024-01-04']]
		);
	});

	test('handles no data', () => {
		assert.deepStrictEqual(rankIntervals([], 'count', 1, 10), {
			rankings: [],
			page: 1,
			totalPages: 0,
			totalItems: 0,
		});
	});

	test('does not mutate the input', () => {
		const input = [...days];
		rankIntervals(input, 'count', 1, 10);
		assert.deepStrictEqual(input, days);
	});
});
