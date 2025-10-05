// src/routes/taskRouter.ts
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
// import { sortedAllFocusData as localSortedAllFocusData } from '../../focus-data/sortedAllFocusData';
// import { allTasks as localAllTasks } from '../../focus-data/allTasks';

dotenv.config();

import {
	getTodayTimeBounds,
	sortArrayByProperty,
	getDayAfterToday,
	arrayToObjectByKey,
} from '../utils/helpers.utils';
import { getJsonData, updateLocalJsonData } from '../utils/mongoose.utils';
import { verifyToken } from '../middleware/verifyToken';
import { fetchAllTickTickTasks } from '../utils/ticktick.utils';

const router = express.Router();
const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;

// new Date(2705792451783) = September 28, 2055. This is to make sure all my tasks are fetched properly. I doubt I'll have to worry about this expiring since I'll be long past TickTick and humans coding anything will be a thing of the past by then with GPT-20 out by then.
const farAwayDateInMs = 2705792451783;

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

		let fromMs = 0;
		let toMs = farAwayDateInMs;

		if (todayOnly) {
			const { startMs, endMs } = getTodayTimeBounds();
			fromMs = startMs;
			toMs = endMs;
		} else {
			// Get the local focus data from MongoDB and since the focus records are already sorted by startTime, get the very first focus record in the array and get it's startTime and set the "toMs" variable to that startTime in MS - 1 ms.
			const semiRecentFocusRecord = localFocusData[20];
			const semiRecentStartTimeDate = new Date(semiRecentFocusRecord.startTime);
			const semiRecentStartTimeInMs = semiRecentStartTimeDate.getTime();

			const todayMs = new Date().getTime();

			// Subtract 1 MS to not include latest focus record in our search.
			fromMs = semiRecentStartTimeInMs;
			toMs = todayMs;
		}

		const focusDataPomos = await axios.get(`https://api.ticktick.com/api/v2/pomodoros?from=${fromMs}&to=${toMs}`, {
			headers: {
				Cookie: cookie,
			},
		});

		const focusDataStopwatch = await axios.get(
			`https://api.ticktick.com/api/v2/pomodoros/timing?from=${fromMs}&to=${toMs}`,
			{
				headers: {
					Cookie: cookie,
				},
			}
		);

		const tickTickOneApiFocusData = [...focusDataPomos.data, ...focusDataStopwatch.data];
		const tickTickOneApiFocusDataById = arrayToObjectByKey(tickTickOneApiFocusData, 'id');
		const localFocusDataById = arrayToObjectByKey(localFocusData, 'id');

		// This is necessary and I can't just check to add focus records that are already in the DB like I did before because I often times edit my focus record after it's been created by updating the focus note. So, if I don't have this logic, then I won't have the latest focus note logic. I'm probably re-writing through around 20 focus records.
		const localFocusDataWithLatestInfo = localFocusData.map((focusRecord: any) => {
			const focusRecordFromApi = tickTickOneApiFocusDataById[focusRecord.id];

			if (focusRecordFromApi) {
				return focusRecordFromApi;
			}

			return focusRecord;
		});

		// Filter out any focus records that are already stored in the database from the API's returned focus records.
		const tickTickOneApiFocusDataNoDupes = tickTickOneApiFocusData.filter((focusData) => {
			const isNotAlreadyInDatabase = localFocusDataById[focusData.id];
			return !isNotAlreadyInDatabase;
		});

		const allFocusData = [...tickTickOneApiFocusDataNoDupes, ...localFocusDataWithLatestInfo];
		const sortedAllFocusData = sortArrayByProperty(allFocusData, 'startTime');

		await updateLocalJsonData({
			name: 'sorted-all-focus-data',
			data: sortedAllFocusData,
		});

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

		await updateLocalJsonData({
			name: 'all-ticktick-tasks',
			data: tickTickOneTasks,
		});

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

		const projects = await axios.get('https://api.ticktick.com/api/v2/projects', {
			headers: {
				Cookie: cookie,
			},
		});

		const allTasks = projects.data;
		res.status(200).json(allTasks);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

router.get('/project-groups', verifyToken, async (req, res) => {
	try {
		// TODO: Should try to store this in MongoDB later. I don't think I've done it yet.
		// if (useLocalData) {
		// 	const localTasks = await getJsonData('project-groups');
		// 	res.status(200).json(localTasks);
		// 	return;
		// }

		const batchCheckResponse = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
			headers: {
				Cookie: cookie,
				'x-device': JSON.stringify({
      				platform: 'web'
				}),
			},
		});

		const projectGroups = batchCheckResponse.data.projectGroups;

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
		await updateLocalJsonData({
			name: 'not-completed-tasks-from-archived-projects',
			data: newNotCompletedTasksFromArchivedProjects,
		});

		await updateLocalJsonData({
			name: 'completed-tasks-from-archived-projects',
			data: newCompletedTasksFromArchivedProjects,
		});

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
