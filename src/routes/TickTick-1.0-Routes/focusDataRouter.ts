// src/routes/taskRouter.ts
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

import { sortedAllFocusData } from '../../focus-data/sortedAllFocusData';
import { allTasks } from '../../focus-data/allTasks';
import { sortArrayByProperty } from '../../utils/helpers.utils';
import { allProjects } from '../../focus-data/allProjects';

const router = express.Router();
const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;
const SERVER_URL = process.env.SERVER_URL;
const localFocusData = sortedAllFocusData;
const localTasks = allTasks;
const localProjects = allProjects;

// router.get('/', async (req, res) => {
// 	try {
// 		const focusRecords = sortedAllFocusData;
// 		res.status(200).json(focusRecords);
// 	} catch (error) {
// 		res.status(500).json({
// 			message: error instanceof Error ? error.message : 'An error occurred fetching the focus data.',
// 		});
// 	}
// });

const useLocalData = true;

router.get('/focus-records', async (req, res) => {
	try {
		if (useLocalData) {
			res.status(200).json(localFocusData);
			return;
		}

		const focusDataPomos = await axios.get('https://api.ticktick.com/api/v2/pomodoros?from=0&to=2705792451783', {
			headers: {
				Cookie: cookie,
			},
		});

		const focusDataStopwatch = await axios.get(
			'https://api.ticktick.com/api/v2/pomodoros/timing?from=0&to=2705792451783',
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
		if (useLocalData) {
			res.status(200).json(localTasks);
			return;
		}

		const notCompletedTasks = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
			headers: {
				Cookie: cookie,
			},
		});

		const tasksToBeUpdated = notCompletedTasks.data.syncTaskBean.update;

		// TODO: Update this so it gets tasks from latest date no matter what.
		const completedTasks = await axios.get(
			'https://api.ticktick.com/api/v2/project/all/completedInAll/?from=&to=2024-09-14%2010:50:58&limit=20000&=',
			{
				headers: {
					Cookie: cookie,
				},
			}
		);

		// Up to this point, the only tasks (both non-completed and completed) are tasks from projects that HAVE NOT been archived. To get tasks that are from archived projects (both non-completed and completed), two additional endpoints will have to be called per archived project to fetch all of the tasks from that archived project (for both the array of non-completed and completed tasks).
		// TODO: Move tasks from archived projects code to here when finished core testing up there!

		const allTasks = [...tasksToBeUpdated, ...completedTasks.data];
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

router.get('/tasks-from-archived-projects', async (req, res) => {
	try {
		if (false && useLocalData) {
			res.status(200).json(localTasks);
			return;
		}

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
					`https://api.ticktick.com/api/v2/project/${id}/completed/?from=&to=2024-09-15%2016:59:12&limit=2000`,
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
