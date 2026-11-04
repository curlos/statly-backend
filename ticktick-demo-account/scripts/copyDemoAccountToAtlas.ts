import dotenv from 'dotenv';
import * as fs from 'fs';
import mongoose from 'mongoose';
import { assertNoSavedCookie, replaceUserDocuments } from '../../src/utils/demoData.utils';

// Copies only the demo account from local MongoDB to Atlas, replacing just that account's documents there. Atlas never loses the demo's documents while this runs: new ones go in first and only the ones that are gone are removed after.
// Run: npx ts-node ticktick-demo-account/scripts/copyDemoAccountToAtlas.ts
const COLLECTIONS = [
	'focusRecords',
	'tasks',
	'projects',
	'projectGroups',
	'user-settings',
	'syncMetaDatas',
	'customImages',
	'customImageFolders',
];
const DEMO_EMAIL = 'statly.demo@gmail.com';

const getUri = (envFile: string) => dotenv.parse(fs.readFileSync(envFile)).ATLAS_URI;

const main = async () => {
	const local = await mongoose.createConnection(getUri('.env.local')).asPromise();
	const atlas = await mongoose.createConnection(getUri('.env')).asPromise();

	const user = await local.collection('users').findOne({ email: DEMO_EMAIL, isDemo: true });
	if (!user) {
		throw new Error('Run setupDemoAccount.ts on the local database first');
	}

	const existingUser = await atlas.collection('users').findOne({ email: DEMO_EMAIL });
	if (existingUser && !existingUser._id.equals(user._id)) {
		throw new Error(`Atlas has a different user with the email ${DEMO_EMAIL}. Nothing was changed.`);
	}

	await assertNoSavedCookie(local.collection('user-settings'), user._id);

	for (const name of COLLECTIONS) {
		const count = await replaceUserDocuments(local.collection(name), atlas.collection(name), user._id);
		console.log(`${name}: ${count}`);
	}

	await atlas.collection('users').replaceOne({ _id: user._id }, user, { upsert: true });

	await local.close();
	await atlas.close();
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
