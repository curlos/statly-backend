import { after, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import CustomImageFolder from '../models/CustomImageFolderModel';
import FocusRecord from '../models/FocusRecord';
import Task from '../models/TaskModel';
import User from '../models/UserModel';
import UserSettings from '../models/UserSettingsModel';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../test-utils/testDb';

const SECRET = 'test-secret';
const DAY = 24 * 60 * 60 * 1000;
const RINGS_HEADER = 'x-guest-focus-goal-rings';

let connected = false;
let server: Server;
let baseUrl = '';
const hasDb = (t: { skip: (message?: string) => void }) => {
	if (!connected) {
		t.skip('MongoDB is not running');
	}
	return connected;
};

const makeRing = (id: string, goalSeconds: number, isActive = true) => ({
	id,
	name: id,
	isActive,
	goalSeconds,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
});

const guestToken = (userId: Types.ObjectId, options: jwt.SignOptions = { expiresIn: '24h' }) =>
	jwt.sign({ userId, isGuest: true }, SECRET, options);
const normalToken = (userId: Types.ObjectId) => jwt.sign({ userId }, SECRET, { expiresIn: '30d' });
const ringsHeader = (rings: object[]) => encodeURIComponent(JSON.stringify(rings));

const call = async (method: string, path: string, token?: string, headers: Record<string, string> = {}) => {
	const response = await fetch(`${baseUrl}${path}`, {
		method,
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
			...headers,
		},
		body: method === 'GET' ? undefined : '{}',
	});
	const text = await response.text();
	let body: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
	try {
		body = JSON.parse(text);
	} catch {
		// Not every response is JSON
	}
	return { status: response.status, body };
};

// The shared account behind guest mode, with one active ring that has a 1 hour goal
const createDemoAccount = async (newestFocusAt = new Date()) => {
	const user = await User.create({
		email: 'statly.demo@gmail.com',
		displayEmail: 'statly.demo@gmail.com',
		password: 'Aa1!aaaa',
		name: 'John Smith',
		isDemo: true,
		demoOriginalNewestFocusAt: newestFocusAt,
	});
	await UserSettings.create({
		userId: user._id,
		tickTickCookie: 'a-secret-encrypted-cookie',
		pages: { focusHoursGoal: { rings: [makeRing('ring-1', 3600)] } },
	});
	return user;
};

// 3 days in a row with 2 hours of focus each, ending 2 days ago
const seedFocusRecords = async (userId: Types.ObjectId) => {
	const records = [3, 4, 5].map((daysAgo) => {
		const start = new Date(new Date().setUTCHours(12, 0, 0, 0) - daysAgo * DAY);
		const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
		return {
			id: `record-${daysAgo}`,
			userId,
			source: 'FocusRecordTickTick',
			startTime: start,
			endTime: end,
			duration: 7200,
			crossesMidnight: false,
			tasks: [{ taskId: 't1', title: 'T', projectId: 'p1', startTime: start, endTime: end, duration: 7200 }],
		};
	});
	await FocusRecord.collection.insertMany(records);
};

describe('guest mode on the server', () => {
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

	describe('logging in as a guest', () => {
		test('is refused when there is no demo account', async (t) => {
			if (!hasDb(t)) return;
			const { status } = await call('POST', '/users/guest');
			assert.strictEqual(status, 404);
		});

		test('gives a 24 hour guest token for the demo account without leaking the password', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();

			const { status, body } = await call('POST', '/users/guest');

			assert.strictEqual(status, 200);
			const decoded = jwt.verify(body.token, SECRET) as jwt.JwtPayload;
			assert.strictEqual(decoded.isGuest, true);
			assert.strictEqual(decoded.userId, String(demo._id));
			assert.strictEqual((decoded.exp as number) - (decoded.iat as number), 24 * 60 * 60);
			assert.strictEqual(body.user.email, 'statly.demo@gmail.com');
			assert.ok(!('password' in body.user));
		});

		test('moves the demo dates up to now', async (t) => {
			if (!hasDb(t)) return;
			const oldNewest = new Date(Date.now() - 30 * DAY - 60 * 60 * 1000);
			const demo = await createDemoAccount(oldNewest);
			await FocusRecord.collection.insertOne({
				id: 'r',
				userId: demo._id,
				source: 'FocusRecordTickTick',
				startTime: oldNewest,
				endTime: oldNewest,
				duration: 0,
				tasks: [],
			});

			await call('POST', '/users/guest');

			const record = await FocusRecord.collection.findOne({ userId: demo._id });
			assert.strictEqual(record?.startTime.getTime(), oldNewest.getTime() + 30 * DAY);
		});

		test("doesn't let a guest in while the dates can't be moved, and works again once they can", async (t) => {
			if (!hasDb(t)) return;
			const oldNewest = new Date(Date.now() - 30 * DAY - 60 * 60 * 1000);
			const demo = await createDemoAccount(oldNewest);
			await FocusRecord.collection.insertOne({
				id: 'r',
				userId: demo._id,
				source: 'FocusRecordTickTick',
				startTime: oldNewest,
				endTime: oldNewest,
				duration: 0,
				tasks: [],
			});

			mock.method(console, 'error', () => undefined);
			const failing = mock.method(Task.collection, 'updateMany', (async () => {
				throw new Error('could not move the tasks');
			}) as never);
			const refused = await call('POST', '/users/guest');
			failing.mock.restore();
			mock.restoreAll();

			assert.strictEqual(refused.status, 503);
			assert.ok(!('token' in refused.body), 'no token is given out');
			assert.strictEqual((await User.findById(demo._id))?.demoDaysShifted, 0);
			assert.strictEqual(
				(await FocusRecord.collection.findOne({ userId: demo._id }))?.startTime.getTime(),
				oldNewest.getTime()
			);

			const retried = await call('POST', '/users/guest');

			assert.strictEqual(retried.status, 200);
			assert.ok(retried.body.token);
			assert.strictEqual(
				(await FocusRecord.collection.findOne({ userId: demo._id }))?.startTime.getTime(),
				oldNewest.getTime() + 30 * DAY
			);
		});

		test('is what makes /users/logged-in-user report a guest', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();

			const asGuest = await call('GET', '/users/logged-in-user', guestToken(demo._id));
			const asNormalLogin = await call('GET', '/users/logged-in-user', normalToken(demo._id));

			assert.strictEqual(asGuest.body.isGuest, true);
			assert.strictEqual(asNormalLogin.body.isGuest, false);
		});
	});

	describe('what a guest token can do', () => {
		test('is read-only: every kind of write is refused before it does anything', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();
			await seedFocusRecords(demo._id);
			const token = guestToken(demo._id);

			const writes = [
				['DELETE', '/delete/all'],
				['DELETE', '/delete/focus-records'],
				['DELETE', '/delete/focus-record/record-3'],
				['POST', '/delete/tasks/bulk-delete'],
				['POST', '/sync/ticktick/all'],
				['POST', '/sync/ticktick/focus-records'],
				['POST', '/import/backup'],
				['POST', '/focus-records/analyze-note-emotions'],
				['POST', '/focus-records/revalidate-crosses-midnight'],
				['PUT', '/user-settings/edit'],
				['PUT', '/users/update-profile'],
				['PUT', '/users/update-password'],
				['POST', '/custom-images/upload'],
				['PUT', '/custom-images/reorder'],
				['POST', '/custom-image-folders'],
				['DELETE', '/custom-image-folders/abc'],
			];

			for (const [method, path] of writes) {
				const { status, body } = await call(method, path, token);
				assert.strictEqual(status, 403, `${method} ${path} should be refused`);
				assert.strictEqual(body.message, 'Not available in guest mode');
			}

			assert.strictEqual(
				await FocusRecord.collection.countDocuments({ userId: demo._id }),
				3,
				'nothing was deleted'
			);
			const settings = await UserSettings.findOne({ userId: demo._id });
			assert.strictEqual(settings?.tickTickCookie, 'a-secret-encrypted-cookie');
		});

		test('can read everything it needs, without seeing the TickTick cookie', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();
			await seedFocusRecords(demo._id);
			const token = guestToken(demo._id);

			for (const path of [
				'/focus-records',
				'/tasks/all',
				'/projects',
				'/stats/overview',
				'/streaks/today',
				'/streaks/history',
				'/focus-records/medals',
			]) {
				const { status } = await call('GET', path, token);
				assert.strictEqual(status, 200, `GET ${path} should work`);
			}

			const { body } = await call('GET', '/user-settings', token);
			assert.ok(!('tickTickCookie' in body));
			assert.strictEqual(body.tickTickCookieSet, true);
		});

		test("reading never saves anything, even the folder that is normally made when it's missing", async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();

			const asGuest = await call('GET', '/custom-image-folders', guestToken(demo._id));

			assert.strictEqual(asGuest.status, 200);
			assert.deepStrictEqual(
				asGuest.body.map((folder: { name: string }) => folder.name),
				['GENERAL']
			);
			assert.strictEqual(
				await CustomImageFolder.countDocuments({ userId: demo._id }),
				0,
				'nothing was saved for the guest'
			);

			// Anyone else still gets it made the first time
			await call('GET', '/custom-image-folders', normalToken(demo._id));
			assert.strictEqual(await CustomImageFolder.countDocuments({ userId: demo._id }), 1);
		});

		test('a normal login to the same account can still write, for looking after the demo', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();
			const token = normalToken(demo._id);

			const edit = await call('PUT', '/user-settings/edit', token);
			const password = await call('PUT', '/users/update-password', token);

			assert.strictEqual(edit.status, 200);
			assert.notStrictEqual(password.status, 403);
		});

		test('an expired guest token gets the exact error the app uses to log people out', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();

			const { status, body } = await call('GET', '/user-settings', guestToken(demo._id, { expiresIn: -60 }));

			assert.strictEqual(status, 401);
			assert.strictEqual(body.message, 'Invalid token');
		});
	});

	describe("a guest's own focus goal settings", () => {
		test('replace the saved rings for streaks, and only for that request', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();
			await seedFocusRecords(demo._id);
			const token = guestToken(demo._id);
			const longestStreak = (body: Record<string, any>) => body.rings[0].longestStreak.days; // eslint-disable-line @typescript-eslint/no-explicit-any

			const saved = await call('GET', '/streaks/history', token);
			const withHardGoal = await call('GET', '/streaks/history', token, {
				[RINGS_HEADER]: ringsHeader([makeRing('ring-1', 4 * 3600)]),
			});
			const savedAgain = await call('GET', '/streaks/history', token);

			assert.strictEqual(longestStreak(saved.body), 3, 'a 1 hour goal is met on all 3 days');
			assert.strictEqual(longestStreak(withHardGoal.body), 0, 'a 4 hour goal is never met');
			assert.strictEqual(longestStreak(savedAgain.body), 3, 'nothing was saved');
			const settings = await UserSettings.findOne({ userId: demo._id });
			assert.strictEqual(settings?.pages?.focusHoursGoal?.rings?.[0]?.goalSeconds, 3600);
		});

		test('can add and pause rings', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();
			const token = guestToken(demo._id);
			const ringIds = (body: Record<string, any>) => body.rings.map((ring: any) => ring.todayData.ringId); // eslint-disable-line @typescript-eslint/no-explicit-any

			const twoActive = await call('GET', '/streaks/today', token, {
				[RINGS_HEADER]: ringsHeader([makeRing('a', 3600), makeRing('b', 3600), makeRing('c', 3600, false)]),
			});
			const nonActive = await call('GET', '/streaks/today', token, {
				[RINGS_HEADER]: ringsHeader([makeRing('a', 3600, false)]),
			});

			assert.deepStrictEqual(ringIds(twoActive.body), ['a', 'b']);
			assert.deepStrictEqual(nonActive.body.rings, []);
		});

		test('are enough for the combined streaks even when the account has no saved settings', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();
			await UserSettings.deleteMany({ userId: demo._id });
			const token = guestToken(demo._id);

			const without = await call('GET', '/streaks/combined', token);
			const withRings = await call('GET', '/streaks/combined', token, {
				[RINGS_HEADER]: ringsHeader([makeRing('a', 3600), makeRing('b', 3600)]),
			});

			assert.deepStrictEqual(without.body.rings, []);
			assert.deepStrictEqual(
				withRings.body.rings.map((ring: { ringId: string }) => ring.ringId),
				['a', 'b']
			);
		});

		test('are ignored when any entry is not a ring', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();
			const token = guestToken(demo._id);

			for (const rings of [[null], [makeRing('a', 3600), 'ring'], [{ id: 'a' }]]) {
				const { status, body } = await call('GET', '/streaks/today', token, {
					[RINGS_HEADER]: encodeURIComponent(JSON.stringify(rings)),
				});
				assert.strictEqual(status, 200);
				assert.deepStrictEqual(
					body.rings.map((ring: { todayData: { ringId: string } }) => ring.todayData.ringId),
					['ring-1']
				);
			}
		});

		test('are ignored for a normal login, and when they are not valid', async (t) => {
			if (!hasDb(t)) return;
			const demo = await createDemoAccount();
			const ringIds = (body: Record<string, any>) => body.rings.map((ring: any) => ring.todayData.ringId); // eslint-disable-line @typescript-eslint/no-explicit-any
			const otherRings = ringsHeader([makeRing('other', 3600)]);

			const normal = await call('GET', '/streaks/today', normalToken(demo._id), { [RINGS_HEADER]: otherRings });
			const brokenJson = await call('GET', '/streaks/today', guestToken(demo._id), {
				[RINGS_HEADER]: '%7Bnot-json',
			});
			const notAList = await call('GET', '/streaks/today', guestToken(demo._id), {
				[RINGS_HEADER]: encodeURIComponent('{"id":"x"}'),
			});

			assert.deepStrictEqual(ringIds(normal.body), ['ring-1']);
			assert.deepStrictEqual(ringIds(brokenJson.body), ['ring-1']);
			assert.deepStrictEqual(ringIds(notAList.body), ['ring-1']);
		});
	});
});
