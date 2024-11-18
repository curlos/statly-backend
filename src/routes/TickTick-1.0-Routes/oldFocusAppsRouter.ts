// src/routes/taskRouter.ts
import express from 'express';
import dotenv from 'dotenv';
import { getJsonData } from '../../utils/mongoose.utils';

dotenv.config();

const router = express.Router();

const getForestDurationSec = (forestFocusRecord: any) => {
	const startTimeStr = forestFocusRecord['Start Time'];
	const endTimeStr = forestFocusRecord['End Time'];

	const startTimeDate = new Date(startTimeStr);
	const endTimeDate = new Date(endTimeStr);

	// Calculate the difference in milliseconds
	// @ts-ignore
	const differenceInMilliseconds = endTimeDate - startTimeDate;

	// Convert milliseconds to seconds
	const differenceInSeconds = differenceInMilliseconds / 1000;
	const durationInSeconds = differenceInSeconds;

	return durationInSeconds;
};

router.get('/forest', async (req, res) => {
	try {
		const forestAppFocusData = await getJsonData('forest-app-data');

		let totalFocus = 0;

		forestAppFocusData.forEach((forestFocusRecord: any) => {
			totalFocus += getForestDurationSec(forestFocusRecord);
		});

		console.log(totalFocus);

		res.status(200).json(forestAppFocusData);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/session', async (req, res) => {
	try {
		const sessionAppFocusData = await getJsonData('session-app-data');
		res.status(200).json(sessionAppFocusData);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/be-focused', async (req, res) => {
	try {
		const beFocusedAppFocusData = await getJsonData('be-focused-app-data');

		let totalFocus = 0;

		beFocusedAppFocusData.forEach((beFocusedFocusRecord: any) => {
			const duration: any = Number(beFocusedFocusRecord['Duration']);
			totalFocus += duration;
		});

		console.log(totalFocus);

		res.status(200).json(beFocusedAppFocusData);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

export default router;
