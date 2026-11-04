import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import FocusRecord from '../models/FocusRecord';
import Task from '../models/TaskModel';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../test-utils/testDb';

const SECRET = 'test-secret';
const HOUR = 60 * 60;

let connected = false;
let server: Server;
let baseUrl = '';
const hasDb = (t: { skip: (message?: string) => void }) => {
	if (!connected) {
		t.skip('MongoDB is not running');
	}
	return connected;
};

const userId = new Types.ObjectId();
const token = jwt.sign({ userId }, SECRET, { expiresIn: '1h' });

const get = async (path: string, withToken = true) => {
	const response = await fetch(`${baseUrl}${path}`, {
		headers: withToken ? { authorization: `Bearer ${token}` } : {},
	});
	return { status: response.status, body: await response.json().catch(() => ({})) };
};

// Completed tasks: 3 on Jan 1 2024, 1 on Jan 2 2024, 2 on Feb 5 2024, 1 on Mar 3 2023
const seedTasks = async (ownerId: Types.ObjectId = userId) => {
	const days = ['2024-01-01', '2024-01-01', '2024-01-01', '2024-01-02', '2024-02-05', '2024-02-05', '2023-03-03'];
	await Task.collection.insertMany(
		days.map((day, i) => ({
			id: `task-${ownerId}-${i}`,
			userId: ownerId,
			title: `Task ${i}`,
			source: 'TaskTickTick',
			completedTime: new Date(`${day}T12:00:00Z`),
		}))
	);
};

// Focus records: 1h on Jan 1 2024, 2h + 1h on Jan 2 2024, 4h on Feb 5 2024
const seedFocusRecords = async () => {
	const records: Array<[string, number]> = [
		['2024-01-01', 1],
		['2024-01-02', 2],
		['2024-01-02', 1],
		['2024-02-05', 4],
	];
	await FocusRecord.collection.insertMany(
		records.map(([day, hours], i) => {
			const start = new Date(`${day}T0${i + 1}:00:00Z`);
			const end = new Date(start.getTime() + hours * HOUR * 1000);
			return {
				id: `record-${i}`,
				userId,
				source: 'FocusRecordTickTick',
				startTime: start,
				endTime: end,
				duration: hours * HOUR,
				crossesMidnight: false,
				tasks: [
					{
						taskId: 't1',
						title: 'T',
						projectId: 'p1',
						startTime: start,
						endTime: end,
						duration: hours * HOUR,
					},
				],
			};
		})
	);
};

describe('GET /stats/rankings', () => {
	before(async () => {
		process.env.JWT_SECRET = SECRET;
		// Stops the app from connecting to the real database and listening on its port
		process.env.VERCEL = '1';

		connected = await connectTestDb();
		if (!connected) {
			return;
		}

		const { default: app } = await import('../app');
		server = app.listen(0);
		baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
	});

	after(async () => {
		server?.close();
		if (connected) {
			await disconnectTestDb();
		}
	});

	beforeEach(async () => {
		if (connected) {
			await clearTestDb();
		}
	});

	test('ranks days by completed tasks, only counting the signed-in user', async (t) => {
		if (!hasDb(t)) return;
		await seedTasks();
		await seedTasks(new Types.ObjectId());

		const { status, body } = await get('/stats/rankings?type=tasks&interval=day&timezone=UTC');

		assert.strictEqual(status, 200);
		assert.deepStrictEqual(body.rankings, [
			{ rank: 1, date: '2024-01-01', count: 3 },
			{ rank: 2, date: '2024-02-05', count: 2 },
			{ rank: 3, date: '2024-01-02', count: 1 },
			{ rank: 4, date: '2023-03-03', count: 1 },
		]);
		assert.strictEqual(body.totalItems, 4);
	});

	test('ranks days by focus time and includes the record count', async (t) => {
		if (!hasDb(t)) return;
		await seedFocusRecords();

		const { status, body } = await get('/stats/rankings?type=focus&interval=day&timezone=UTC');

		assert.strictEqual(status, 200);
		assert.deepStrictEqual(body.rankings, [
			{ rank: 1, date: '2024-02-05', count: 1, duration: 4 * HOUR },
			{ rank: 2, date: '2024-01-02', count: 2, duration: 3 * HOUR },
			{ rank: 3, date: '2024-01-01', count: 1, duration: 1 * HOUR },
		]);
	});

	test('keeps 0-minute days that a long-running record spans', async (t) => {
		if (!hasDb(t)) return;
		// 15 minutes of focus on Dec 8, but the record was left open until Dec 11
		const start = new Date('2020-12-08T21:00:00Z');
		const taskEnd = new Date('2020-12-08T21:15:00Z');
		await FocusRecord.collection.insertOne({
			id: 'long-record',
			userId,
			source: 'FocusRecordTickTick',
			startTime: start,
			endTime: new Date('2020-12-11T10:00:00Z'),
			duration: 15 * 60,
			crossesMidnight: true,
			tasks: [
				{ taskId: 't1', title: 'T', projectId: 'p1', startTime: start, endTime: taskEnd, duration: 15 * 60 },
			],
		});

		const { body } = await get('/stats/rankings?type=focus&interval=day&timezone=UTC&sort=least');
		assert.deepStrictEqual(
			body.rankings.map((r: { date: string; count: number; duration: number }) => [r.date, r.count, r.duration]),
			[
				['2020-12-11', 1, 0],
				['2020-12-10', 1, 0],
				['2020-12-09', 1, 0],
				['2020-12-08', 1, 15 * 60],
			]
		);
	});

	test('rejects an invalid type, interval or sort', async (t) => {
		if (!hasDb(t)) return;

		assert.strictEqual((await get('/stats/rankings?type=bad&interval=day')).status, 400);
		assert.strictEqual((await get('/stats/rankings?type=tasks&interval=bad')).status, 400);
		assert.strictEqual((await get('/stats/rankings?type=tasks&interval=day&sort=bad')).status, 400);
	});

	test('requires a token', async (t) => {
		if (!hasDb(t)) return;
		assert.strictEqual((await get('/stats/rankings?type=tasks&interval=day', false)).status, 401);
	});
});
