import mongoose from 'mongoose';

// Tests that need a database use a throwaway one on the local MongoDB (or the server in TEST_MONGO_URI) and delete it afterwards. They need a replica set, since some of them use transactions. When nothing is configured they are skipped if there is no MongoDB running, but asking for a server with TEST_MONGO_URI and not being able to reach it is an error.
const TEST_DB_PREFIX = 'statly-test-';
const STALE_AFTER_MS = 5 * 60 * 1000;

// A run that is stopped partway, like when a file watcher restarts it, never gets to delete its database. So each run clears out the ones left behind by earlier runs. Only databases named like the throwaway ones (with the time they were made in the name) that are well past any run's length are touched, and it's skipped quietly if the server doesn't allow listing databases.
const dropStaleTestDbs = async () => {
	try {
		const client = mongoose.connection.getClient();
		const { databases } = await client.db().admin().listDatabases();

		for (const { name } of databases) {
			const madeAt = Number(name.match(new RegExp(`^${TEST_DB_PREFIX}(\\d+)-\\d+$`))?.[1]);
			if (madeAt && Date.now() - madeAt > STALE_AFTER_MS) {
				await client.db(name).dropDatabase();
			}
		}
	} catch {
		// Not being able to tidy up shouldn't stop the tests
	}
};

export const connectTestDb = async () => {
	const configuredUri = process.env.TEST_MONGO_URI;
	const dbName = `${TEST_DB_PREFIX}${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

	try {
		// The name is an option so it replaces any database named in the URI, along with keeping its other options
		await mongoose.connect(configuredUri || 'mongodb://localhost:27017', {
			dbName,
			serverSelectionTimeoutMS: 2000,
		});
		await dropStaleTestDbs();
		return true;
	} catch (error) {
		if (configuredUri) {
			throw error;
		}
		return false;
	}
};

export const clearTestDb = async () => {
	await Promise.all(Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})));
};

export const disconnectTestDb = async () => {
	// Never drop anything that isn't one of these throwaway databases
	if (mongoose.connection.name?.startsWith(TEST_DB_PREFIX)) {
		await mongoose.connection.dropDatabase();
	}
	await mongoose.disconnect();
};
