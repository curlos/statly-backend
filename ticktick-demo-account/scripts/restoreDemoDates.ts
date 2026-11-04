import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { restoreDemoDates } from '../../src/utils/demoData.utils';

// Puts the demo account's dates back to the originals and turns guest mode off, so guests don't shift them forward again. Run setupDemoAccount.ts to turn it back on.
// Run: npx ts-node ticktick-demo-account/scripts/restoreDemoDates.ts
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });

const DEMO_EMAIL = 'statly.demo@gmail.com';

const main = async () => {
	await mongoose.connect(process.env.ATLAS_URI as string);

	const days = await restoreDemoDates(DEMO_EMAIL);

	console.log(`Moved the dates back ${days} days. Guest mode is off.`);
	await mongoose.disconnect();
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
