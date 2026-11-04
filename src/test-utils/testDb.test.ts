import { test } from 'node:test';
import assert from 'node:assert';
import mongoose from 'mongoose';
import { MongoClient } from 'mongodb';
import { connectTestDb } from './testDb';

const TEST_DB_PREFIX = 'statly-test-';

test('connectTestDb fails loudly when the server it was told to use can not be reached', async () => {
	process.env.TEST_MONGO_URI = 'mongodb://127.0.0.1:1/some-database';

	try {
		await assert.rejects(connectTestDb());
	} finally {
		delete process.env.TEST_MONGO_URI;
	}
});

test('connectTestDb keeps the rest of the URI but always uses its own throwaway database', async (t) => {
	process.env.TEST_MONGO_URI = 'mongodb://localhost:27017/a-real-database?retryWrites=true&w=majority';

	try {
		await connectTestDb();
	} catch {
		return t.skip('MongoDB is not running');
	} finally {
		delete process.env.TEST_MONGO_URI;
	}

	try {
		assert.ok(mongoose.connection.name?.startsWith(TEST_DB_PREFIX), `connected to ${mongoose.connection.name}`);
	} finally {
		await mongoose.disconnect();
	}
});

test('connectTestDb clears out throwaway databases left behind by runs that were stopped, but only old ones', async (t) => {
	const client = new MongoClient('mongodb://localhost:27017', { serverSelectionTimeoutMS: 2000 });
	const oldName = `${TEST_DB_PREFIX}${Date.now() - 10 * 60 * 1000}-1`;
	const recentName = `${TEST_DB_PREFIX}${Date.now()}-2`;
	const notOursName = `not-a-test-database-${Date.now() - 10 * 60 * 1000}-3`;
	let ownName: string | undefined;

	try {
		await client.connect();
	} catch {
		return t.skip('MongoDB is not running');
	}

	try {
		for (const name of [oldName, recentName, notOursName]) {
			await client.db(name).collection('something').insertOne({ a: 1 });
		}

		assert.strictEqual(await connectTestDb(), true);
		ownName = mongoose.connection.name;

		const names = (await client.db().admin().listDatabases()).databases.map((database) => database.name);
		assert.ok(!names.includes(oldName), 'the old throwaway database is gone');
		assert.ok(names.includes(recentName), 'a recent one could belong to a run that is still going');
		assert.ok(names.includes(notOursName), 'anything not named like a throwaway database is left alone');
	} finally {
		await mongoose.disconnect();
		for (const name of [oldName, recentName, notOursName]) {
			await client.db(name).dropDatabase();
		}
		// And the one connectTestDb made for itself. Never any other, since other tests are using theirs at the same time.
		if (ownName) {
			await client.db(ownName).dropDatabase();
		}
		await client.close();
	}
});
