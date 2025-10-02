// src/routes/taskRouter.ts
import express from 'express';
import dotenv from 'dotenv';
import { getJsonData } from '../utils/mongoose.utils';
import { verifyToken } from '../middleware/verifyToken';

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
		let todoistPersonalCompletedTasksById = doNotUseMongoDB
			? todoistAllPersonalCompletedTasksById
			: (useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-personal-completed-tasks-by-id') : await getJsonData('todoist-personal-completed-tasks-by-id'));
		let todoistPersonalActiveTasksById = doNotUseMongoDB
			? todoistAllPersonalActiveTasksById
			: (useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-personal-active-tasks-by-id') : await getJsonData('todoist-personal-active-tasks-by-id'));

		// Q Link
		let todoistQLinkCompletedTasksById = doNotUseMongoDB
			? todoistAllQLinkCompletedTasksById
			: (useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-qlink-completed-tasks-by-id') : await getJsonData('todoist-qlink-completed-tasks-by-id'));
		let todoistQLinkActiveTasksById = doNotUseMongoDB
			? todoistAllQLinkActiveTasksById
			: (useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-qlink-active-tasks-by-id') : await getJsonData('todoist-qlink-active-tasks-by-id'));

		const todoistAllSyncTasksById = {
			...todoistPersonalCompletedTasksById,
			...todoistPersonalActiveTasksById,
			...todoistQLinkCompletedTasksById,
			...todoistQLinkActiveTasksById,
		};

		const api_v1_todoist_all_personal_completed_tasks_by_id = await getJsonData('api_v1_todoist_all_personal_completed_tasks_by_id')
		const api_v1_todoist_all_personal_active_tasks_by_id = await getJsonData('api_v1_todoist_all_personal_active_tasks_by_id')
		const api_v1_todoist_all_work_completed_tasks_by_id = await getJsonData('api_v1_todoist_all_work_completed_tasks_by_id')
		const api_v1_todoist_all_work_active_tasks_by_id = await getJsonData('api_v1_todoist_all_work_active_tasks_by_id')

		const todoistAllApiV1TasksById = {
			...api_v1_todoist_all_personal_completed_tasks_by_id,
			...api_v1_todoist_all_personal_active_tasks_by_id,
			...api_v1_todoist_all_work_completed_tasks_by_id,
			...api_v1_todoist_all_work_active_tasks_by_id
		}

		const allSyncTasksWithOnlyItem = Object.values(todoistAllSyncTasksById).map((task: any) => task.item)
		const allSyncTasksThatDoNotAppearInAPIV1 = allSyncTasksWithOnlyItem.filter((task) => {
			const task_v2_id = task["v2_id"]

			// @ts-ignore
			return !todoistAllApiV1TasksById[task_v2_id]
		});
		const allNewAPIV1Tasks = Object.values(todoistAllApiV1TasksById)
		const allTasks = [
			...allSyncTasksThatDoNotAppearInAPIV1,
			...allNewAPIV1Tasks
		]

		const todoistTasksThatOnlyAppearInAPIV1 = getTodoistTasksThatOnlyAppearInAPIV1(todoistAllSyncTasksById, allNewAPIV1Tasks)

		// @ts-ignore
		// console.log(`todoistTasksThatOnlyAppearInAPIV1 = ${todoistTasksThatOnlyAppearInAPIV1.length}`)
		// console.log(`allSyncTasksThatDoNotAppearInAPIV1 = ${allSyncTasksThatDoNotAppearInAPIV1.length}`)

		res.status(200).json(allTasks);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

router.get('/todoist-all-projects', verifyToken, async (req, res) => {
	const useNewSyncDataTodoistData = true

	try {
		// Personal
		const todoistPersonalActiveProjects = useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-personal-active-projects') : await getJsonData('todoist-personal-active-projects');
		const todoistPersonalArchivedProjects = useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-personal-archived-projects') : await getJsonData('todoist-personal-archived-projects');

		// Q Link
		const todoistQLinkActiveProjects = useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-qlink-active-projects') : await getJsonData('todoist-qlink-active-projects');
		const todoistQLinkArchivedProjects = useNewSyncDataTodoistData ? await getJsonData('sync-2025-todoist-qlink-archived-projects') : await getJsonData('todoist-qlink-archived-projects');

		// TODO: After confirming that everything on production is good, remove this as I probably don't really need this.
		const todoistAllSyncProjects = [
			...todoistPersonalActiveProjects,
			...todoistPersonalArchivedProjects,
			...todoistQLinkActiveProjects,
			...todoistQLinkArchivedProjects,
		];

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
			// ...todoistAllSyncProjects,
			...todoistAllApiV1Projects
		]

		res.status(200).json(allProjects);
	} catch (error) {
		res.status(500).json({ message: 'Error fetching data', error });
	}
});

// @ts-ignore
const getTodoistTasksThatOnlyAppearInAPIV1 = (todoistAllSyncTasksById, allNewAPIV1Tasks) => {
	const syncTasksByV2Id = {};

	for (const key in todoistAllSyncTasksById) {
		const entry = todoistAllSyncTasksById[key];
		const v2Id = entry.item?.v2_id;

		if (v2Id) {
			// @ts-ignore
			syncTasksByV2Id[v2Id] = entry;
		}
	}

	// @ts-ignore
	const apiV1TasksThatAreNotInSync = allNewAPIV1Tasks.filter((task) => {
		// @ts-ignore
		return !syncTasksByV2Id[task.id]
	})

	return apiV1TasksThatAreNotInSync
}

export default router;
