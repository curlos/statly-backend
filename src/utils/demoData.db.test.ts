import { after, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert';
import mongoose, { Types } from 'mongoose';
import FocusRecord from '../models/FocusRecord';
import Task from '../models/TaskModel';
import User from '../models/UserModel';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../test-utils/testDb';
import { assertNoSavedCookie, replaceUserDocuments, restoreDemoDates, shiftDemoDataIfStale, shiftUserDates } from './demoData.utils';

const DAY = 24 * 60 * 60 * 1000;
const DAYS_BEHIND = 10;

let connected = false;
const hasDb = (t: { skip: (message?: string) => void }) => {
	if (!connected) {
		t.skip('MongoDB is not running');
	}
	return connected;
};

// The newest focus record is 10 days and 3 hours old, so the demo data needs to move exactly 10 days
const originalNewest = new Date(Date.now() - DAYS_BEHIND * DAY - 3 * 60 * 60 * 1000);
const daysFromNewest = (days: number) => new Date(originalNewest.getTime() + days * DAY);

const createUser = (email: string, isDemo: boolean) =>
	User.create({
		email,
		displayEmail: email,
		password: 'Aa1!aaaa',
		name: email,
		isDemo,
		demoOriginalNewestFocusAt: originalNewest,
	});

const seedData = async (userId: Types.ObjectId) => {
	const record = (id: string, start: Date, taskTimes: boolean) => ({
		id,
		userId,
		source: 'FocusRecordTickTick',
		startTime: start,
		endTime: new Date(start.getTime() + 30 * 60 * 1000),
		duration: 1800,
		tasks: taskTimes ? [{ taskId: 't1', title: 'T', startTime: start, endTime: new Date(start.getTime() + 30 * 60 * 1000) }] : [],
	});

	await FocusRecord.collection.insertMany([record('newest', daysFromNewest(0), true), record('older', daysFromNewest(-40), true), record('no-tasks', daysFromNewest(-3), false)]);

	await Task.collection.insertMany([
		{ id: 'done', userId, source: 'TaskTickTick', completedTime: daysFromNewest(-1), createdTime: daysFromNewest(-50), modifiedTime: daysFromNewest(-1), startDate: daysFromNewest(-2) },
		// Never completed, and without a start date at all
		{ id: 'open', userId, source: 'TaskTickTick', completedTime: null, createdTime: daysFromNewest(-5) },
	]);
};

const getFocusRecord = (userId: Types.ObjectId, id: string) => FocusRecord.collection.findOne({ userId, id });
const getTask = (userId: Types.ObjectId, id: string) => Task.collection.findOne({ userId, id });

describe('demo account dates', () => {
	before(async () => {
		connected = await connectTestDb();
	});

	after(async () => {
		if (connected) {
			await disconnectTestDb();
		}
	});

	beforeEach(async () => {
		if (connected) {
			await clearTestDb();
		}
	});

	test('moves every date by the same whole days, so the newest record lands just before now', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', true);
		await seedData(user._id);

		await shiftDemoDataIfStale(user);

		const newest = await getFocusRecord(user._id, 'newest');
		assert.strictEqual(newest?.startTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime());
		assert.strictEqual(newest?.endTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime() + 30 * 60 * 1000);
		assert.strictEqual(newest?.tasks[0].startTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime());
		assert.strictEqual(newest?.tasks[0].endTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime() + 30 * 60 * 1000);
		assert.ok(newest!.startTime.getTime() <= Date.now(), 'the newest record is not in the future');
		assert.ok(Date.now() - newest!.startTime.getTime() < DAY, 'the newest record is less than a day old');

		// Gaps between records stay the same
		const older = await getFocusRecord(user._id, 'older');
		assert.strictEqual(newest!.startTime.getTime() - older!.startTime.getTime(), 40 * DAY);

		const done = await getTask(user._id, 'done');
		assert.strictEqual(done?.completedTime.getTime(), daysFromNewest(DAYS_BEHIND - 1).getTime());
		assert.strictEqual(done?.createdTime.getTime(), daysFromNewest(DAYS_BEHIND - 50).getTime());
		assert.strictEqual(done?.modifiedTime.getTime(), daysFromNewest(DAYS_BEHIND - 1).getTime());
		assert.strictEqual(done?.startDate.getTime(), daysFromNewest(DAYS_BEHIND - 2).getTime());

		const saved = await User.findById(user._id);
		assert.strictEqual(saved?.demoDaysShifted, DAYS_BEHIND);
	});

	test('leaves empty and missing dates empty and missing', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', true);
		await seedData(user._id);

		await shiftDemoDataIfStale(user);

		const open = await getTask(user._id, 'open');
		assert.strictEqual(open?.completedTime, null);
		assert.ok(!('startDate' in (open as object)), 'a task without a start date still has none');
		assert.strictEqual(open?.createdTime.getTime(), daysFromNewest(DAYS_BEHIND - 5).getTime());

		const noTasks = await getFocusRecord(user._id, 'no-tasks');
		assert.deepStrictEqual(noTasks?.tasks, []);
	});

	test("doesn't touch anyone else's data or a normal account", async (t) => {
		if (!hasDb(t)) return;
		const demo = await createUser('demo@example.com', true);
		const other = await createUser('other@example.com', false);
		await seedData(demo._id);
		await seedData(other._id);

		await shiftDemoDataIfStale(demo);
		// Even a normal account with the demo fields filled in is left alone
		await shiftDemoDataIfStale(other);

		const otherNewest = await getFocusRecord(other._id, 'newest');
		assert.strictEqual(otherNewest?.startTime.getTime(), daysFromNewest(0).getTime());
		const otherTask = await getTask(other._id, 'done');
		assert.strictEqual(otherTask?.completedTime.getTime(), daysFromNewest(-1).getTime());
		assert.strictEqual((await User.findById(other._id))?.demoDaysShifted, 0);
	});

	test("doesn't shift again when nothing new is due", async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', true);
		await seedData(user._id);

		await shiftDemoDataIfStale(user);
		const freshUser = await User.findById(user._id);
		await shiftDemoDataIfStale(freshUser!);
		await shiftDemoDataIfStale(freshUser!);

		const newest = await getFocusRecord(user._id, 'newest');
		assert.strictEqual(newest?.startTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime());
		assert.strictEqual((await User.findById(user._id))?.demoDaysShifted, DAYS_BEHIND);
	});

	test('only shifts once when several guests arrive at the same time', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', true);
		await seedData(user._id);

		// Every guest starts from the same stale copy of the user, which is exactly the race
		const results = await Promise.all(Array.from({ length: 8 }, () => shiftDemoDataIfStale(user)));

		assert.ok(results.every((result) => result === true), 'every one of them is fine, since the others just find it already done');
		const newest = await getFocusRecord(user._id, 'newest');
		assert.strictEqual(newest?.startTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime());
		assert.strictEqual((await User.findById(user._id))?.demoDaysShifted, DAYS_BEHIND);
	});

	test('only moves forward the days that are new when it has been shifted before', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', true);
		await seedData(user._id);

		// It was shifted 7 of the 10 days earlier, and the dates in the database reflect that
		await shiftUserDates(user._id, 7);
		await User.updateOne({ _id: user._id }, { $set: { demoDaysShifted: 7 } });

		await shiftDemoDataIfStale((await User.findById(user._id))!);

		const newest = await getFocusRecord(user._id, 'newest');
		assert.strictEqual(newest?.startTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime());
		assert.strictEqual((await User.findById(user._id))?.demoDaysShifted, DAYS_BEHIND);
	});

	test('moving back the days that were shifted restores the original dates', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', true);
		await seedData(user._id);

		await shiftDemoDataIfStale(user);
		const shifted = await User.findById(user._id);
		await shiftUserDates(user._id, -(shifted!.demoDaysShifted as number));

		const newest = await getFocusRecord(user._id, 'newest');
		assert.strictEqual(newest?.startTime.getTime(), daysFromNewest(0).getTime());
		assert.strictEqual(newest?.tasks[0].endTime.getTime(), daysFromNewest(0).getTime() + 30 * 60 * 1000);
		const done = await getTask(user._id, 'done');
		assert.strictEqual(done?.completedTime.getTime(), daysFromNewest(-1).getTime());
		const open = await getTask(user._id, 'open');
		assert.strictEqual(open?.completedTime, null);
		assert.ok(!('startDate' in (open as object)));
	});

	test('a shift that fails halfway changes nothing, and the next one finishes the job', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', true);
		await seedData(user._id);

		// The focus records are moved but then the tasks fail
		mock.method(console, 'error', () => undefined);
		const failing = mock.method(Task.collection, 'updateMany', (async () => {
			throw new Error('the tasks could not be moved');
		}) as never);
		const failed = await shiftDemoDataIfStale(user);
		failing.mock.restore();
		mock.restoreAll();

		assert.strictEqual(failed, false);
		assert.strictEqual((await User.findById(user._id))?.demoDaysShifted, 0, 'the days are not counted as shifted');
		const unmoved = await getFocusRecord(user._id, 'newest');
		assert.strictEqual(unmoved?.startTime.getTime(), daysFromNewest(0).getTime(), 'the focus records that were moved are back');
		assert.strictEqual(unmoved?.tasks[0].startTime.getTime(), daysFromNewest(0).getTime());

		const retried = await shiftDemoDataIfStale(user);

		assert.strictEqual(retried, true);
		const newest = await getFocusRecord(user._id, 'newest');
		assert.strictEqual(newest?.startTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime());
		assert.strictEqual((await getTask(user._id, 'done'))?.completedTime.getTime(), daysFromNewest(DAYS_BEHIND - 1).getTime());
		assert.strictEqual((await User.findById(user._id))?.demoDaysShifted, DAYS_BEHIND);
	});

	describe('restoring the demo account', () => {
	test('puts the original dates back and turns the demo off so nothing shifts them again', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', true);
		await seedData(user._id);
		await shiftDemoDataIfStale(user);

		const days = await restoreDemoDates('demo@example.com');

		assert.strictEqual(days, DAYS_BEHIND);
		const restored = await User.findById(user._id);
		assert.strictEqual(restored?.isDemo, false);
		assert.strictEqual(restored?.demoDaysShifted, 0);
		assert.strictEqual((await getFocusRecord(user._id, 'newest'))?.startTime.getTime(), daysFromNewest(0).getTime());
		assert.strictEqual((await getTask(user._id, 'done'))?.completedTime.getTime(), daysFromNewest(-1).getTime());

		// A guest arriving now, or one that was already part way in with an out of date copy of the user, changes nothing
		await shiftDemoDataIfStale(restored!);
		await shiftDemoDataIfStale(user);
		assert.strictEqual((await getFocusRecord(user._id, 'newest'))?.startTime.getTime(), daysFromNewest(0).getTime());
	});

	test('is found by email, so it works after the demo has been turned off', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('demo@example.com', false);
		await seedData(user._id);

		assert.strictEqual(await restoreDemoDates('demo@example.com'), 0);
		await assert.rejects(restoreDemoDates('nobody@example.com'), /No user found/);
	});

		test('a restore that fails halfway changes nothing, so it can just be run again', async (t) => {
			if (!hasDb(t)) return;
			const user = await createUser('demo@example.com', true);
			await seedData(user._id);
			await shiftDemoDataIfStale(user);

			mock.method(Task.collection, 'updateMany', (async () => {
				throw new Error('the tasks could not be moved back');
			}) as never);
			await assert.rejects(restoreDemoDates('demo@example.com'), /could not be moved back/);
			mock.restoreAll();

			const untouched = await User.findById(user._id);
			assert.strictEqual(untouched?.isDemo, true, 'the demo is still on');
			assert.strictEqual(untouched?.demoDaysShifted, DAYS_BEHIND);
			assert.strictEqual((await getFocusRecord(user._id, 'newest'))?.startTime.getTime(), daysFromNewest(DAYS_BEHIND).getTime(), 'the focus records are still where they were');

			assert.strictEqual(await restoreDemoDates('demo@example.com'), DAYS_BEHIND);
			assert.strictEqual((await getFocusRecord(user._id, 'newest'))?.startTime.getTime(), daysFromNewest(0).getTime());
		});

		test('waits for a shift that is part way through, then restores everything it moved', async (t) => {
			if (!hasDb(t)) return;
			const user = await createUser('demo@example.com', true);
			await seedData(user._id);

			// The shift is held up after it has moved the focus records, with the tasks still to go
			let release: () => void = () => undefined;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			let held = 0;
			const originalUpdateMany = Task.collection.updateMany;
			mock.method(Task.collection, 'updateMany', function (this: unknown, ...args: unknown[]) {
				held++;
				return gate.then(() => (originalUpdateMany as (...a: unknown[]) => unknown).apply(this, args));
			} as never);

			const shift = shiftDemoDataIfStale(user);
			while (held === 0) {
				await new Promise((resolve) => setTimeout(resolve, 20));
			}

			// The restore starts while that is happening
			const restore = restoreDemoDates('demo@example.com');
			await new Promise((resolve) => setTimeout(resolve, 400));
			release();
			await Promise.all([shift, restore]);
			mock.restoreAll();

			const saved = await User.findById(user._id);
			assert.strictEqual(saved?.isDemo, false);
			assert.strictEqual(saved?.demoDaysShifted, 0);
			assert.strictEqual((await getFocusRecord(user._id, 'newest'))?.startTime.getTime(), daysFromNewest(0).getTime(), 'the focus records are the originals');
			assert.strictEqual((await getTask(user._id, 'done'))?.completedTime.getTime(), daysFromNewest(-1).getTime(), 'the tasks are the originals');
		});
	});

	describe('copying the demo account', () => {
	const source = () => mongoose.connection.collection('copySource');
	const target = () => mongoose.connection.collection('copyTarget');
	const targetIds = async (userId: Types.ObjectId) => (await target().find({ userId }).toArray()).map((document) => document.name).sort();

	test('makes the target match the source, keeping other users and removing what the demo no longer has', async (t) => {
		if (!hasDb(t)) return;
		const userId = new Types.ObjectId();
		const otherUserId = new Types.ObjectId();
		const [a, b, c] = [new Types.ObjectId(), new Types.ObjectId(), new Types.ObjectId()];
		await source().insertMany([{ _id: a, userId, name: 'a-new' }, { _id: b, userId, name: 'b-new' }]);
		// "a" is already there but out of date, "c" is gone from the source, and someone else's document must stay
		await target().insertMany([{ _id: a, userId, name: 'a-old' }, { _id: c, userId, name: 'c-old' }, { _id: new Types.ObjectId(), userId: otherUserId, name: 'someone-else' }]);

		const count = await replaceUserDocuments(source(), target(), userId);

		assert.strictEqual(count, 2);
		assert.deepStrictEqual(await targetIds(userId), ['a-new', 'b-new']);
		assert.deepStrictEqual(await targetIds(otherUserId), ['someone-else']);
	});

	test('leaves what the target has alone when putting the new documents in fails', async (t) => {
		if (!hasDb(t)) return;
		const userId = new Types.ObjectId();
		await source().insertMany([{ _id: new Types.ObjectId(), userId, name: 'new' }]);
		await target().insertMany([{ _id: new Types.ObjectId(), userId, name: 'old-1' }, { _id: new Types.ObjectId(), userId, name: 'old-2' }]);

		const failing = mock.method(target(), 'bulkWrite', (async () => {
			throw new Error('could not write');
		}) as never);
		await assert.rejects(replaceUserDocuments(source(), target(), userId), /could not write/);
		failing.mock.restore();

		assert.deepStrictEqual(await targetIds(userId), ['old-1', 'old-2']);
	});

	test('copies nothing and clears nothing it should keep when the source has no documents for the user', async (t) => {
		if (!hasDb(t)) return;
		const userId = new Types.ObjectId();
		await target().insertMany([{ _id: new Types.ObjectId(), userId, name: 'old' }]);

		assert.strictEqual(await replaceUserDocuments(source(), target(), userId), 0);
		assert.deepStrictEqual(await targetIds(userId), []);
	});
	});

	describe('checking the demo account has no TickTick cookie', () => {
		const settings = () => mongoose.connection.collection('cookieCheckSettings');

		test('stops when a cookie is saved, whatever it is, and passes when there is none', async (t) => {
			if (!hasDb(t)) return;
			const userId = new Types.ObjectId();

			await assert.doesNotReject(assertNoSavedCookie(settings(), userId), 'no settings at all');

			await settings().insertOne({ userId, tickTickCookie: '' });
			await assert.doesNotReject(assertNoSavedCookie(settings(), userId), 'an empty cookie');

			await settings().updateOne({ userId }, { $set: { tickTickCookie: 'abcdef0123' } });
			await assert.rejects(assertNoSavedCookie(settings(), userId), /still has a TickTick cookie/);

			await assert.doesNotReject(assertNoSavedCookie(settings(), new Types.ObjectId()), "someone else's cookie doesn't count");
		});
	});
});
