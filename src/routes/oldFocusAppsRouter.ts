// src/routes/taskRouter.ts
import express from 'express';
import dotenv from 'dotenv';
import { getJsonData } from '../utils/mongoose.utils';
import { verifyToken } from '../middleware/verifyToken';
import { getAllTodoistTasks } from '../utils/task.utils';

dotenv.config();

const router = express.Router();

const doNotUseMongoDB = false;

const {
	SESSION_DATA, BE_FOCUSED_DATA, FOREST_DATA, TIDE_DATA
} = {
	SESSION_DATA: {}, BE_FOCUSED_DATA: {}, FOREST_DATA: {}, TIDE_DATA: {}
}

router.get('/focus-records/session-app', verifyToken, async (req, res) => {
	try {
		const noBreaks = req.query['no-breaks'];

		const sessionAppFocusData = doNotUseMongoDB ? SESSION_DATA : await getJsonData('session-app-data');

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

router.get('/focus-records/be-focused-app', verifyToken, async (req, res) => {
	try {
		const beFocusedAppFocusData = doNotUseMongoDB ? BE_FOCUSED_DATA : await getJsonData('be-focused-app-data');

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

router.get('/focus-records/forest-app', verifyToken, async (req, res) => {
	try {
		const forestAppFocusData = doNotUseMongoDB ? FOREST_DATA : await getJsonData('forest-app-data');

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

router.get('/focus-records/tide-app', verifyToken, async (req, res) => {
	try {
		const sessionAppFocusData = doNotUseMongoDB ? TIDE_DATA : await getJsonData('tide-ios-app-focus-records');
		res.status(200).json(sessionAppFocusData);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/todoist-all-tasks', verifyToken, async (req, res) => {
	try {
		const allTasks = await getAllTodoistTasks();
		res.status(200).json(allTasks);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/todoist-all-projects', verifyToken, async (req, res) => {
	try {
		const api_v1_todoist_all_personal_active_projects = await getJsonData('api_v1_todoist_all_personal_active_projects')
		const api_v1_todoist_all_personal_archived_projects = await getJsonData('api_v1_todoist_all_personal_archived_projects')
		const api_v1_todoist_all_work_active_projects = await getJsonData('api_v1_todoist_all_work_active_projects')
		const api_v1_todoist_all_work_archived_projects = await getJsonData('api_v1_todoist_all_work_archived_projects')

		const todoistAllApiV1Projects = [
			...api_v1_todoist_all_personal_active_projects,
			...api_v1_todoist_all_personal_archived_projects,
			...api_v1_todoist_all_work_active_projects,
			...api_v1_todoist_all_work_archived_projects
		]

		const allProjects = [
			...todoistAllApiV1Projects
		]

		res.status(200).json(allProjects);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

export default router;
