import { after, afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import cloudinary from '../config/cloudinary';
import ApiCallStatus from '../models/ApiCallStatusModel';
import CustomImage from '../models/CustomImageModel';
import CustomImageFolder from '../models/CustomImageFolderModel';
import FocusRecord from '../models/FocusRecord';
import Project from '../models/ProjectModel';
import ProjectGroupTickTick from '../models/ProjectGroupModel';
import SyncMetadata from '../models/SyncMetadataModel';
import Task from '../models/TaskModel';
import User from '../models/UserModel';
import UserSettings from '../models/UserSettingsModel';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../test-utils/testDb';

const SECRET = 'test-secret';
const PASSWORD = 'Aa1!aaaa';

let connected = false;
let server: Server;
let baseUrl = '';
const hasDb = (t: { skip: (message?: string) => void }) => {
	if (!connected) {
		t.skip('MongoDB is not running');
	}
	return connected;
};

const tokenFor = (userId: Types.ObjectId, isGuest = false) =>
	jwt.sign({ userId, ...(isGuest ? { isGuest } : {}) }, SECRET, { expiresIn: '1h' });

// Sends DELETE /users/delete-account with the given token and JSON body
const deleteAccount = async (token: string, body: object = {}) => {
	const response = await fetch(`${baseUrl}/users/delete-account`, {
		method: 'DELETE',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify(body),
	});
	return { status: response.status, body: await response.json() };
};

// Inserts one document per user-owned collection, skipping validation since only the userId matters here
const seedUserData = async (userId: Types.ObjectId) => {
	await Promise.all([
		FocusRecord.collection.insertOne({ id: 'f1', userId }),
		Task.collection.insertOne({ id: 't1', userId }),
		Project.collection.insertOne({ id: 'p1', userId }),
		ProjectGroupTickTick.collection.insertOne({ id: 'g1', userId }),
		SyncMetadata.collection.insertOne({ userId, syncType: 'tickTickTasks' }),
		UserSettings.collection.insertOne({ userId }),
		CustomImage.collection.insertOne({ userId, folder: 'GENERAL' }),
		CustomImageFolder.collection.insertOne({ userId, name: 'GENERAL' }),
		ApiCallStatus.collection.insertOne({ userId, apiEndpoint: '/x' }),
	]);
};

// Every model that stores a userId, which seedUserData puts one document in each of
const USER_OWNED_MODELS = [
	FocusRecord,
	Task,
	Project,
	ProjectGroupTickTick,
	SyncMetadata,
	UserSettings,
	CustomImage,
	CustomImageFolder,
	ApiCallStatus,
];
const SEEDED_DOCUMENT_COUNT = USER_OWNED_MODELS.length;

// Counts the user's documents across every user-owned collection
const countUserData = async (userId: Types.ObjectId) => {
	const counts = await Promise.all(USER_OWNED_MODELS.map((model) => model.collection.countDocuments({ userId })));
	return counts.reduce((sum, count) => sum + count, 0);
};

const createUser = (email: string) => User.create({ email, displayEmail: email, password: PASSWORD, name: 'Test' });

describe('deleting an account', () => {
	let deleteFromCloudinary: ReturnType<typeof mock.fn>;

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
		deleteFromCloudinary = mock.method(cloudinary.api, 'delete_resources_by_prefix', async () => ({}));
		if (connected) {
			await clearTestDb();
		}
	});

	afterEach(() => {
		mock.restoreAll();
	});

	test('needs a password', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('a@test.com');
		await seedUserData(user._id);

		const { status } = await deleteAccount(tokenFor(user._id));

		assert.strictEqual(status, 400);
		assert.ok(await User.exists({ _id: user._id }));
		assert.strictEqual(await countUserData(user._id), SEEDED_DOCUMENT_COUNT);
	});

	test('keeps everything when the password is wrong', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('a@test.com');
		await seedUserData(user._id);

		const { status, body } = await deleteAccount(tokenFor(user._id), { password: 'wrong' });

		assert.strictEqual(status, 401);
		assert.strictEqual(body.message, 'Incorrect password');
		assert.ok(await User.exists({ _id: user._id }));
		assert.strictEqual(await countUserData(user._id), SEEDED_DOCUMENT_COUNT);
		assert.strictEqual(deleteFromCloudinary.mock.callCount(), 0);
	});

	test('deletes the user, all of their data and their Cloudinary folder, but no one else’s', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('a@test.com');
		const otherUser = await createUser('b@test.com');
		await seedUserData(user._id);
		await seedUserData(otherUser._id);

		const { status } = await deleteAccount(tokenFor(user._id), { password: PASSWORD });

		assert.strictEqual(status, 200);
		assert.strictEqual(await User.exists({ _id: user._id }), null);
		assert.strictEqual(await countUserData(user._id), 0);
		assert.deepStrictEqual(deleteFromCloudinary.mock.calls[0].arguments, [`Statly/users/${user._id}/`]);

		assert.ok(await User.exists({ _id: otherUser._id }));
		assert.strictEqual(await countUserData(otherUser._id), SEEDED_DOCUMENT_COUNT);
	});

	test('still deletes the account when Cloudinary fails', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('a@test.com');
		mock.method(console, 'error', () => undefined);
		deleteFromCloudinary.mock.mockImplementation(async () => {
			throw new Error('Cloudinary is down');
		});

		const { status } = await deleteAccount(tokenFor(user._id), { password: PASSWORD });

		assert.strictEqual(status, 200);
		assert.strictEqual(await User.exists({ _id: user._id }), null);
	});

	test('is not allowed for guests', async (t) => {
		if (!hasDb(t)) return;
		const user = await createUser('a@test.com');

		const { status } = await deleteAccount(tokenFor(user._id, true), { password: PASSWORD });

		assert.strictEqual(status, 403);
		assert.ok(await User.exists({ _id: user._id }));
	});
});
