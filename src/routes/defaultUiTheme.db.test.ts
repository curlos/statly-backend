import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Types } from 'mongoose';
import User from '../models/UserModel';
import UserSettings from '../models/UserSettingsModel';
import { clearTestDb, connectTestDb, disconnectTestDb } from '../test-utils/testDb';

let connected = false;
let server: Server;
let baseUrl = '';
const hasDb = (t: { skip: (message?: string) => void }) => {
	if (!connected) {
		t.skip('MongoDB is not running');
	}
	return connected;
};

// Warzone is the UI theme everyone starts on until they pick another one
describe('the default UI theme', () => {
	before(async () => {
		process.env.JWT_SECRET = 'test-secret';
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

	test('a newly registered account starts on Warzone', async (t) => {
		if (!hasDb(t)) return;

		const response = await fetch(`${baseUrl}/users/register`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				name: 'New User',
				email: 'new@example.com',
				password: 'Aa1!aaaa',
				colorMode: 'dark',
			}),
		});
		assert.ok(response.ok, `register failed with ${response.status}`);

		const user = await User.findOne({ email: 'new@example.com' });
		const settings = await UserSettings.findOne({ userId: user?._id }).lean();
		assert.strictEqual(settings?.theme?.uiTheme, 'warzone');
	});

	test('settings that never saved a UI theme read as Warzone', async (t) => {
		if (!hasDb(t)) return;

		const userId = new Types.ObjectId();
		await UserSettings.collection.insertOne({ userId, source: 'UserSettings', theme: { color: 'blue-500' } });

		const settings = await UserSettings.findOne({ userId });
		assert.strictEqual(settings?.theme?.uiTheme, 'warzone');
	});

	test('a theme the user picked is kept, including Default', async (t) => {
		if (!hasDb(t)) return;

		const userId = new Types.ObjectId();
		await UserSettings.create({ userId, theme: { uiTheme: 'default' } });

		const settings = await UserSettings.findOne({ userId });
		assert.strictEqual(settings?.theme?.uiTheme, 'default');
	});
});
