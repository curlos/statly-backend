import dotenv from 'dotenv';
import mongoose from 'mongoose';
import FocusRecord from '../../src/models/FocusRecord';
import Task from '../../src/models/TaskModel';
import User from '../../src/models/UserModel';
import UserSettings from '../../src/models/UserSettingsModel';

// One-time setup of the account behind guest mode. Run: npx ts-node ticktick-demo-account/scripts/setupDemoAccount.ts
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });

const DEMO_EMAIL = 'statly.demo@gmail.com';

const main = async () => {
	await mongoose.connect(process.env.ATLAS_URI as string);

	const user = await User.findOne({ email: DEMO_EMAIL });
	if (!user) {
		throw new Error(`No user found with the email ${DEMO_EMAIL}`);
	}
	if (user.demoDaysShifted) {
		throw new Error('The dates are shifted. Run restoreDemoDates.ts first.');
	}

	const userId = user._id;
	const newestRecord = await FocusRecord.findOne({ userId }).sort({ startTime: -1 });
	if (!newestRecord) {
		throw new Error('The demo account has no focus records');
	}

	// Nothing should be newer than the newest focus record or shifting would put it in the future
	const newestFocusAt = newestRecord.startTime;
	const pulledBack = await Task.collection.updateMany(
		{ userId, completedTime: { $gt: newestFocusAt } },
		{ $set: { completedTime: newestFocusAt } }
	);

	// Syncing would bring back the old dates so the account shouldn't be able to sync
	await UserSettings.updateOne({ userId }, { $set: { tickTickCookie: '', autoSyncEnabled: false } });

	// Guests can't run the analysis themselves so the emotion tags need to be there already
	const { analyzeNoteEmotionsCore } = await import('../../src/controllers/sentimentBatchController');
	const records = await FocusRecord.find({
		userId,
		note: { $nin: [null, ''] },
		$or: [{ emotions: { $exists: false } }, { emotions: { $size: 0 } }, { emotions: null }],
	}).select('_id');
	const recordIds = records.map((record) => String(record._id));
	let analyzed = 0;
	for (let i = 0; i < recordIds.length; i += 50) {
		const result = await analyzeNoteEmotionsCore(recordIds.slice(i, i + 50), userId as mongoose.Types.ObjectId);
		analyzed += result.analyzed;
	}
	console.log(`Analyzed emotions for ${analyzed} of ${recordIds.length} records.`);

	// Guest mode only goes live once everything above has worked, so a failure leaves the account as it was and this can just be run again
	await User.updateOne(
		{ _id: userId },
		{ $set: { isDemo: true, demoOriginalNewestFocusAt: newestFocusAt, demoDaysShifted: 0 } }
	);

	console.log(
		`Demo account ready. Newest focus record: ${newestFocusAt.toISOString()}. Tasks pulled back: ${pulledBack.modifiedCount}.`
	);
	await mongoose.disconnect();
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
