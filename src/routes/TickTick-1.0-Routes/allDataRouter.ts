// src/routes/taskRouter.ts
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

import { sortedAllFocusData } from '../../focus-data/sortedAllFocusData';
import { allTasks } from '../../focus-data/allTasks';
import { getTodayTimeBounds, sortArrayByProperty } from '../../utils/helpers.utils';
import { allProjects } from '../../focus-data/allProjects';
// Do not delete the local files for these as they are necessary for when we making live API calls to fetch data in "/tasks". They aren't needed for local data as they're already stored there but needed for real-time calls.
import { completedTasksFromArchivedProjects } from '../../focus-data/archivedTasks/completedTasksFromArchivedProjects';
import { notCompletedTasksFromArchivedProjects } from '../../focus-data/archivedTasks/notCompletedTasksFromArchivedProjects';
import { allTags } from '../../focus-data/allTags';
import { getDayAfterToday } from '../../utils/helpers.utils';

const router = express.Router();
const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;
const SERVER_URL = process.env.SERVER_URL;
const localFocusData = sortedAllFocusData;
const localTasks = allTasks;
const localProjects = allProjects;
const localTags = allTags;

// new Date(2705792451783) = September 28, 2055. This is to make sure all my tasks are fetched properly. I doubt I'll have to worry about this expiring since I'll be long past TickTick and humans coding anything will be a thing of the past by then with GPT-20 out by then.
const farAwayDateInMs = 2705792451783;

const useLocalData = false;

router.get('/focus-records', async (req, res) => {
	try {
		const todayOnly = req.query.today === 'true';

		if (useLocalData) {
			res.status(200).json(localFocusData);
			return;
		}

		let fromMs = 0
		let toMs = farAwayDateInMs

		if (todayOnly) {
			const { startMs, endMs } = getTodayTimeBounds();
            fromMs = startMs;
            toMs = endMs;
		}

		const focusDataPomos = await axios.get(
			`https://api.ticktick.com/api/v2/pomodoros?from=${fromMs}&to=${toMs}`,
			{
				headers: {
					Cookie: cookie,
				},
			}
		);

		const focusDataStopwatch = await axios.get(
			`https://api.ticktick.com/api/v2/pomodoros/timing?from=${fromMs}&to=${toMs}`,
			{
				headers: {
					Cookie: cookie,
				},
			}
		);

		const allFocusData = [...focusDataPomos.data, ...focusDataStopwatch.data];
		const sortedAllFocusData = sortArrayByProperty(allFocusData, 'startTime');

		res.status(200).json(sortedAllFocusData);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

router.get('/tasks', async (req, res) => {
	try {
		const dayAfterTodayStr = getDayAfterToday();

		if (useLocalData) {
			res.status(200).json(localTasks);
			return;
		}

		const batchCheckResponse = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
			headers: {
				Cookie: cookie,
			},
		});

		// TODO: Update this so it gets tasks from latest date no matter what.
		const completedTasksResponse = await axios.get(
			`https://api.ticktick.com/api/v2/project/all/completedInAll/?from=&to=${dayAfterTodayStr}%2010:50:58&limit=20000&=`,
			{
				headers: {
					Cookie: cookie,
				},
			}
		);

		const willNotDoTasksResponse = await axios.get(
			`https://api.ticktick.com/api/v2/project/all/closed/?from=&to=${dayAfterTodayStr}%2010:50:58&limit=20000&=&status=Abandoned`,
			{
				headers: {
					Cookie: cookie,
				},
			}
		);

		const trashTasksResponse = await axios.get(
			`https://api.ticktick.com/api/v2/project/all/trash/page?limit=9999999`,
			{
				headers: {
					Cookie: cookie,
				},
			}
		);

		const tasksToBeUpdated = batchCheckResponse.data.syncTaskBean.update;
		const completedTasks = completedTasksResponse.data;
		const willNotDoTasks = willNotDoTasksResponse.data;
		const { tasks: trashTasks } = trashTasksResponse.data;

		const allTasks = [
			...tasksToBeUpdated,
			...completedTasks,
			...completedTasksFromArchivedProjects,
			...notCompletedTasksFromArchivedProjects,
			...willNotDoTasks,
			...trashTasks,
		];
		res.status(200).json(allTasks);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

router.get('/projects', async (req, res) => {
	try {
		if (useLocalData) {
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

router.get('/tags', async (req, res) => {
	try {
		if (useLocalData) {
			res.status(200).json(localTags);
			return;
		}

		const batchCheckResponse = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
			headers: {
				Cookie: cookie,
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

/**
 * @description On TickTick 1.0, tasks that are under Archived Projects do not appear in the "/api/v2/project/all/completedInAll" OR "/api/v2/batch/check/0" API endpoints unfortunately. The only way to manually get the task objects is to call two separate endpoints per archived project "/api/v2/project/${projectId}/tasks" AND "/api/v2/project/${id}/completed". I currently have 46 archived projects as of September 15, 2024 so this will make 92 API calls.
 *
 * @IMPORTANT This should only be called manually from POSTMAN. NEVER CALL this from anywhere else automatically like on the Frontend. This will make up to 80-90+ API calls on average to TickTick 1.0. Calling so many API calls at once seems quite dangerous and would look unusual on their servers I'm sure so do not call this unless I absoltuely need the latest data about my archived projects. I already have the cached data about my archived projects so I will typically not really need this UNTIL I archive a project which will hide previous tasks.
 *
 * @Tutorial Steps to get updated tasks data from ARCHIVED projects:
 * 1. On Postman, manually make the call to "/tasks-from-archived-projects".
 * 2. Get the Completed and Non-Completed tasks from the API calls of all of the projects.
 * 3. Store them in local data in the "focus-data" folder and then set "doNotMakeApiCalls" variable to true to prevent accidentally making the API calls in the future.
 */
router.get('/tasks-from-archived-projects', async (req, res) => {
	const doNotMakeApiCalls = true;

	// Most of the time, just return the local tasks data instead of making all the API calls to TickTick 1.0.
	if (doNotMakeApiCalls) {
		res.status(200).send("You're safe from dangerous calls here friend.");
		return;
	}

	try {
		const dayAfterTodayStr = getDayAfterToday();
		const getTasksFromArchivedProjects = true;

		if (getTasksFromArchivedProjects) {
			console.log(`${SERVER_URL}/ticktick-1.0/projects`);

			// Get all the projects
			const projectsResponse = await axios.get(`${SERVER_URL}/ticktick-1.0/projects`, {
				headers: {
					Cookie: cookie,
				},
			});

			const projects = projectsResponse.data;

			// Get all the archived projects by filtering from the list of all projects
			const archivedProjects = projects.filter((project: any) => project.closed);

			const allNonCompletedTasks = [];
			const allCompletedTasks = [];

			// For each archived project, make two API calls to TickTick 1.0: Get the non-completed and completed tasks for that specific project. This will be an O(2N) call. So, if there are 46 archived projects, there will be 92 API calls made. This is A LOT of calls made at once. This operation should not be done very frequently. The best thing to do is to grab the data, store it locally and then live with any future incosistencies for now. And then maybe get the real data once in a while (every couple of months) manaully and update the local data.
			for (const project of archivedProjects) {
				const { id } = project;

				const nonCompletedTasksForProjectResponse = await axios.get(
					`https://api.ticktick.com/api/v2/project/${id}/tasks`,
					{
						headers: {
							Cookie: cookie,
						},
					}
				);

				const completedTasksForProjectResponse = await axios.get(
					`https://api.ticktick.com/api/v2/project/${id}/completed/?from=&to=${dayAfterTodayStr}%2016:59:12&limit=9999`,
					{
						headers: {
							Cookie: cookie,
						},
					}
				);

				const nonCompletedTasksForProject = nonCompletedTasksForProjectResponse.data;
				const completedTasksForProject = completedTasksForProjectResponse.data;

				allNonCompletedTasks.push(...nonCompletedTasksForProject);
				allCompletedTasks.push(...completedTasksForProject);
			}

			res.status(200).json({
				allNonCompletedTasks,
				allCompletedTasks,
			});
			return;
		}

		res.status(200).json({});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

export default router;
