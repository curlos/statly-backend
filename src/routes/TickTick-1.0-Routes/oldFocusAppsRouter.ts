// src/routes/taskRouter.ts
import express from 'express';
import dotenv from 'dotenv';
import { getJsonData } from '../../utils/mongoose.utils';

dotenv.config();

const router = express.Router();

router.get('/focus-records/session-app', async (req, res) => {
	try {
		const noBreaks = req.query['no-breaks'];

		const sessionAppFocusData = await getJsonData('session-app-data');

		if (noBreaks) {
			const focusRecordsWithNoBreaks = sessionAppFocusData.filter(
				(focusRecord: any) => focusRecord['type'] === 'fullFocus'
			);

			return res.status(200).json(focusRecordsWithNoBreaks);
		}

		return res.status(200).json(sessionAppFocusData);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/focus-records/be-focused-app', async (req, res) => {
	try {
		const beFocusedAppFocusData = await getJsonData('be-focused-app-data');

		let totalFocus = 0;

		beFocusedAppFocusData.forEach((beFocusedFocusRecord: any) => {
			const duration: any = Number(beFocusedFocusRecord['Duration']);
			totalFocus += duration;
		});

		res.status(200).json(beFocusedAppFocusData);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/focus-records/forest-app', async (req, res) => {
	try {
		const forestAppFocusData = await getJsonData('forest-app-data');

		const beforeSessionApp = req.query['before-session-app'];

		if (beforeSessionApp) {
			const cutoffDate = new Date('April 14, 2021');

			const filteredData = forestAppFocusData.filter((item: any) => {
				const itemStartDate = new Date(item['Start Time']);

				// Return true if the item's start date is before the cutoff date
				return itemStartDate < cutoffDate;
			});

			return res.status(200).json(filteredData);
		}

		res.status(200).json(forestAppFocusData);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/focus-records/tide-app', async (req, res) => {
	try {
		const sessionAppFocusData = await getJsonData('tide-ios-app-focus-records');
		res.status(200).json(sessionAppFocusData);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/todoist-all-completed-tasks', async (req, res) => {
	try {
		const todoistAllCompletedTasks = await getJsonData('todoist-all-completed-tasks');
		res.status(200).json(todoistAllCompletedTasks);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/todoist-all-tasks-by-id', async (req, res) => {
	try {
		const todoistAllTasksById = await getJsonData('todoist-all-tasks-by-id');
		res.status(200).json(todoistAllTasksById);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

export default router;
