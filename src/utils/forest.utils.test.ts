import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getProjectSeconds, getTopProject } from './forest.utils';

describe('getProjectSeconds', () => {
	it('adds up each project from its own tasks, not from the whole record', () => {
		const seconds = getProjectSeconds([
			{ projectId: 'leetcode', duration: 420 },
			{ projectId: 'side', duration: 2400 },
			{ projectId: 'leetcode', duration: 180 },
		]);
		assert.deepEqual(
			[...seconds],
			[
				['leetcode', 600],
				['side', 2400],
			]
		);
	});

	it('groups tasks without a project together, and has nothing for a record with no tasks', () => {
		assert.deepEqual([...getProjectSeconds([{ duration: 100 }, { projectId: null, duration: 50 }])], [['', 150]]);
		assert.equal(getProjectSeconds([]).size, 0);
		assert.equal(getProjectSeconds(undefined).size, 0);
	});
});

describe('getTopProject', () => {
	it('picks the project with the most total time', () => {
		const result = getTopProject([
			{ projectId: 'a', duration: 600 },
			{ projectId: 'b', duration: 1800 },
		]);
		assert.deepEqual(result, { projectId: 'b', seconds: 1800 });
	});

	it('adds up several tasks from the same project before comparing', () => {
		const result = getTopProject([
			{ projectId: 'a', duration: 600 },
			{ projectId: 'b', duration: 900 },
			{ projectId: 'a', duration: 600 },
		]);
		assert.deepEqual(result, { projectId: 'a', seconds: 1200 });
	});

	it('gives a tie to the project that appears first', () => {
		assert.equal(
			getTopProject([
				{ projectId: 'a', duration: 900 },
				{ projectId: 'b', duration: 900 },
			]).projectId,
			'a'
		);
		assert.equal(
			getTopProject([
				{ projectId: 'b', duration: 900 },
				{ projectId: 'a', duration: 900 },
			]).projectId,
			'b'
		);
		assert.equal(
			getTopProject([
				{ projectId: 'a', duration: 300 },
				{ projectId: 'b', duration: 900 },
				{ projectId: 'c', duration: 900 },
			]).projectId,
			'b'
		);
	});

	it('treats tasks without a project as one group that can also win', () => {
		assert.deepEqual(
			getTopProject([{ duration: 1200 }, { projectId: null, duration: 300 }, { projectId: 'a', duration: 600 }]),
			{ projectId: '', seconds: 1500 }
		);
	});

	it('returns no project for a record with no tasks', () => {
		assert.deepEqual(getTopProject([]), { projectId: '', seconds: 0 });
		assert.deepEqual(getTopProject(undefined), { projectId: '', seconds: 0 });
	});

	it('still picks a project when every task has zero time', () => {
		assert.equal(
			getTopProject([
				{ projectId: 'a', duration: 0 },
				{ projectId: 'b', duration: 0 },
			]).projectId,
			'a'
		);
	});
});
