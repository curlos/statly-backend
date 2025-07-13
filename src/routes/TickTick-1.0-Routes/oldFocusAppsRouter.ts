// src/routes/taskRouter.ts
import express from 'express';
import dotenv from 'dotenv';
import { getJsonData } from '../../utils/mongoose.utils';
import { verifyToken } from '../../middleware/verifyToken';

// import { SESSION_DATA } from '../../focus-data/2021-2022-focus-data-from-other-apps/Session/SESSION_DATA';
// import { BE_FOCUSED_DATA } from '../../focus-data/2021-2022-focus-data-from-other-apps/BeFocused/BE_FOCUSED';
// import { FOREST_DATA } from '../../focus-data/2021-2022-focus-data-from-other-apps/Forest/FOREST';
// import { TIDE_DATA } from '../../focus-data/2021-2022-focus-data-from-other-apps/TIDE-IOS-APP/TIDE_DATA';

// import { todoistAllPersonalCompletedTasksById } from '../../focus-data/Todoist/personal/todoistAllPersonalCompletedTasksById';
// import { todoistAllPersonalActiveTasksById } from '../../focus-data/Todoist/personal/todoistAllPersonalActiveTasksById';

// import { todoistAllQLinkCompletedTasksById } from '../../focus-data/Todoist/qlink/todoistAllQLinkCompletedTasksById';
// import { todoistAllQLinkActiveTasksById } from '../../focus-data/Todoist/qlink/todoistAllQLinkActiveTasksById';

dotenv.config();

const router = express.Router();

const doNotUseMongoDB = false;

const {
	SESSION_DATA, BE_FOCUSED_DATA, FOREST_DATA, TIDE_DATA, todoistAllPersonalCompletedTasksById, todoistAllPersonalActiveTasksById, todoistAllQLinkCompletedTasksById, todoistAllQLinkActiveTasksById
} = {
	SESSION_DATA: {}, BE_FOCUSED_DATA: {}, FOREST_DATA: {}, TIDE_DATA: {}, todoistAllPersonalCompletedTasksById: {}, todoistAllPersonalActiveTasksById: {}, todoistAllQLinkCompletedTasksById: {}, todoistAllQLinkActiveTasksById: {}
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
	const useNewSyncDataTodoistData = true

	try {
		// Personal
		const todoistPersonalCompletedTasksById = doNotUseMongoDB
			? todoistAllPersonalCompletedTasksById
			: (useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-personal-completed-tasks-by-id') : await getJsonData('todoist-personal-completed-tasks-by-id'));
		const todoistPersonalActiveTasksById = doNotUseMongoDB
			? todoistAllPersonalActiveTasksById
			: (useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-personal-active-tasks-by-id') : await getJsonData('todoist-personal-active-tasks-by-id'));

		// Q Link
		const todoistQLinkCompletedTasksById = doNotUseMongoDB
			? todoistAllQLinkCompletedTasksById
			: (useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-qlink-completed-tasks-by-id') : await getJsonData('todoist-qlink-completed-tasks-by-id'));
		const todoistQLinkActiveTasksById = doNotUseMongoDB
			? todoistAllQLinkActiveTasksById
			: (useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-qlink-active-tasks-by-id') : await getJsonData('todoist-qlink-active-tasks-by-id'));

		const todoistAllTasksById = {
			...todoistPersonalCompletedTasksById,
			...todoistPersonalActiveTasksById,
			...todoistQLinkCompletedTasksById,
			...todoistQLinkActiveTasksById,
		};

		const allTasksWithOnlyItem = Object.values(todoistAllTasksById).map((task: any) => task.item);

		res.status(200).json(allTasksWithOnlyItem);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

// router.get('/todoist-all-completed-tasks', verifyToken, async (req, res) => {
// 	try {
// 		const todoistPersonalCompletedTasks = await getJsonData('todoist-personal-completed-tasks');
// 		const todoistQLinkCompletedTasks = await getJsonData('todoist-qlink-completed-tasks');
// 		const todoistAllCompletedTasks = [...todoistPersonalCompletedTasks.items, ...todoistQLinkCompletedTasks.items];

// 		res.status(200).json(todoistAllCompletedTasks);
// 	} catch (error) {
// 		res.status(500).json({ message: 'Error fetching data', error });
// 	}
// });

// router.get('/todoist-all-tasks-by-id', verifyToken, async (req, res) => {
// 	try {
// 		// Personal
// 		const todoistPersonalCompletedTasksById = await getJsonData('todoist-personal-completed-tasks-by-id');
// 		const todoistPersonalActiveTasksById = await getJsonData('todoist-personal-active-tasks-by-id');

// 		// Q Link
// 		const todoistQLinkCompletedTasksById = await getJsonData('todoist-qlink-completed-tasks-by-id');
// 		const todoistQLinkActiveTasksById = await getJsonData('todoist-qlink-active-tasks-by-id');

// 		const todoistAllTasksById = {
// 			...todoistPersonalCompletedTasksById,
// 			...todoistPersonalActiveTasksById,
// 			...todoistQLinkCompletedTasksById,
// 			...todoistQLinkActiveTasksById,
// 		};

// 		res.status(200).json(todoistAllTasksById);
// 	} catch (error) {
// 		res.status(500).json({ message: 'Error fetching data', error });
// 	}
// });

router.get('/todoist-all-projects', verifyToken, async (req, res) => {
	const useNewSyncDataTodoistData = true

	try {
		// Personal
		const todoistPersonalActiveProjects = useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-personal-active-projects') : await getJsonData('todoist-personal-active-projects');
		const todoistPersonalArchivedProjects = useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-personal-archived-projects') : await getJsonData('todoist-personal-archived-projects');

		// Q Link
		const todoistQLinkActiveProjects = useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-qlink-active-projects') : await getJsonData('todoist-qlink-active-projects');
		const todoistQLinkArchivedProjects = useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-qlink-archived-projects') : await getJsonData('todoist-qlink-archived-projects');

		const todoistAllProjects = [
			...todoistPersonalActiveProjects,
			...todoistPersonalArchivedProjects,
			...todoistQLinkActiveProjects,
			...todoistQLinkArchivedProjects,
		];

		res.status(200).json(todoistAllProjects);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

export default router;
