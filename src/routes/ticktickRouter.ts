// src/routes/taskRouter.ts
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

import {
	getDayAfterToday,
	arrayToObjectByKey,
} from '../utils/helpers.utils';
import { getJsonData, updateLocalJsonData } from '../utils/mongoose.utils';
import { verifyToken } from '../middleware/verifyToken';
import { fetchAllTickTickTasks, fetchAllTickTickProjects, fetchAllTickTickProjectGroups } from '../utils/ticktick.utils';
import { fetchTickTickFocusRecords } from '../utils/focus.utils';

const router = express.Router();
const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;

const useLocalData = false;
const doNotUseMongoDB = false;

const { localSortedAllFocusData, localAllTasks } = {
	localSortedAllFocusData: {},
	localAllTasks: {}
}

router.get('/focus-records', verifyToken, async (req, res) => {
	try {
		const todayOnly = req.query.today === 'true';

		const localFocusData = doNotUseMongoDB ? localSortedAllFocusData : await getJsonData('sorted-all-focus-data');

		if (useLocalData) {
			res.status(200).json(localFocusData);
			return;
		}

		const sortedAllFocusData = await fetchTickTickFocusRecords({
			todayOnly,
			doNotUseMongoDB,
			localSortedAllFocusData,
		});

		// await updateLocalJsonData({
		// 	name: 'sorted-all-focus-data',
		// 	data: sortedAllFocusData,
		// });

		res.status(200).json(sortedAllFocusData);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

router.get('/tasks', verifyToken, async (req, res) => {
	try {
		if (useLocalData) {
			const localTasks = doNotUseMongoDB ? localAllTasks : await getJsonData('all-ticktick-tasks');
			res.status(200).json(localTasks);
			return;
		}

		const tickTickOneTasks = await fetchAllTickTickTasks();

		// await updateLocalJsonData({
		// 	name: 'all-ticktick-tasks',
		// 	data: tickTickOneTasks,
		// });

		res.status(200).json(tickTickOneTasks);
	} catch (error) {
		console.error(error)
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

router.get('/projects', verifyToken, async (req, res) => {
	try {
		if (useLocalData) {
			const localProjects = await getJsonData('all-projects');
			res.status(200).json(localProjects);
			return;
		}

		const projects = await fetchAllTickTickProjects();
		res.status(200).json(projects);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

router.get('/project-groups', verifyToken, async (req, res) => {
	try {
		const projectGroups = await fetchAllTickTickProjectGroups();
		res.status(200).json(projectGroups);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

router.get('/tags', verifyToken, async (req, res) => {
	try {
		if (useLocalData) {
			const localTags = await getJsonData('all-tags');
			res.status(200).json(localTags);
			return;
		}

		const batchCheckResponse = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
			headers: {
				Cookie: cookie,
				'x-device': JSON.stringify({
      				platform: 'web'
				}),
			},
		});

		const tags = batchCheckResponse.data.tags;

		res.status(200).json(tags);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

// Route to get data by name
router.get('/json-data/:name', verifyToken, async (req, res) => {
	try {
		const dataName = req.params.name;
		const data = await getJsonData(dataName);
		res.json({ success: true, data: data });
	} catch (error) {
		res.status(404).json({
			success: false,
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

router.put('/update-active-and-completed-tasks-from-archived-projects', verifyToken, async (req, res) => {
	try {
		const { projectIds } = req.body;

		const dayAfterTodayStr = getDayAfterToday();

		const apiNotCompletedTasks = [];
		const apiCompletedTasks = [];

		// Get all the not completed and completed tasks for each project.
		for (const id of projectIds) {
			// Not Completed Tasks
			const notCompletedTasksForProjectResponse = await axios.get(
				`https://api.ticktick.com/api/v2/project/${id}/tasks`,
				{
					headers: {
						Cookie: cookie,
					},
				}
			);

			// Completed Tasks
			const completedTasksForProjectResponse = await axios.get(
				`https://api.ticktick.com/api/v2/project/${id}/completed/?from=&to=${dayAfterTodayStr}%2016:59:12&limit=9999`,
				{
					headers: {
						Cookie: cookie,
					},
				}
			);

			const notCompletedTasksForProject = notCompletedTasksForProjectResponse.data;
			const completedTasksForProject = completedTasksForProjectResponse.data;

			apiNotCompletedTasks.push(...notCompletedTasksForProject);
			apiCompletedTasks.push(...completedTasksForProject);
		}
		
		// Get the existing completed and not completed tasks from archived projects from the database.
		const completedTasksFromArchivedProjects = await getJsonData('completed-tasks-from-archived-projects');
		const notCompletedTasksFromArchivedProjects = await getJsonData('not-completed-tasks-from-archived-projects');

		const apiNotCompletedTasksById = arrayToObjectByKey(apiNotCompletedTasks, 'id');
		const apiCompletedTasksById = arrayToObjectByKey(apiCompletedTasks, 'id');

		// From the DB's version of these tasks, filter out any tasks that also appear in the API response. In theory, the API would have the latest data and thus its version should be prioritized. (Though practically, it probably doesn't matter? These are tasks from archived projects which are impossible to mess with or edit unless I unarchive the project at which point the task will not appear anywhere here. Maybe if I archive, unarchive, and then re-archive the project something would happen. I usually only archive a project when I know I'm done with it for forever.)
		const dbNotCompletedTasksFromArchivedProjectsNoDupes = notCompletedTasksFromArchivedProjects.filter((task: any) => {
			const isNotAlreadyInApiResponse = apiNotCompletedTasksById[task.id];
			return !isNotAlreadyInApiResponse;
		});

		const dbCompletedTasksFromArchivedProjectsNoDupes = completedTasksFromArchivedProjects.filter((task: any) => {
			const isNotAlreadyInApiResponse = apiCompletedTasksById[task.id];
			return !isNotAlreadyInApiResponse;
		});

		const newNotCompletedTasksFromArchivedProjects = [...dbNotCompletedTasksFromArchivedProjectsNoDupes, ...apiNotCompletedTasks]
		const newCompletedTasksFromArchivedProjects = [...dbCompletedTasksFromArchivedProjectsNoDupes, ...apiCompletedTasks]

		// Update the DB with the newest not completed and completed tasks from archived projects. This'll very useful whenever I archive a project.
		// await updateLocalJsonData({
		// 	name: 'not-completed-tasks-from-archived-projects',
		// 	data: newNotCompletedTasksFromArchivedProjects,
		// });

		// await updateLocalJsonData({
		// 	name: 'completed-tasks-from-archived-projects',
		// 	data: newCompletedTasksFromArchivedProjects,
		// });

		res.status(200).json({
			apiNotCompletedTasks,
			apiCompletedTasks,
		});
		return;
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

export default router;
