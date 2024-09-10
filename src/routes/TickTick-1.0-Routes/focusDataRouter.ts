// src/routes/taskRouter.ts
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

import { sortedAllFocusData } from '../../focus-data/allFocusData';
import { allTasks } from '../../focus-data/allTasks';
import { sortArrayByProperty } from '../../utils/helpers.utils';
import { allProjects } from '../../focus-data/allProjects';

const router = express.Router();
const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
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

router.get('/focus-records', async (req, res) => {
	try {
		const useLocalData = true;

		if (useLocalData) {
			res.status(200).json(localFocusData);
			return;
		}

		const cookie = TICKTICK_API_COOKIE;
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
		const useLocalData = true;

		if (useLocalData) {
			res.status(200).json(localTasks);
			return;
		}

		const cookie = TICKTICK_API_COOKIE;
		const notCompletedTasks = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
			headers: {
				Cookie: cookie,
			},
		});

		const tasksToBeUpdated = notCompletedTasks.data.syncTaskBean.update;

		const completedTasks = await axios.get(
			'https://api.ticktick.com/api/v2/project/all/completedInAll/?from=&to=2024-09-11%2010:50:58&limit=20000&=',
			{
				headers: {
					Cookie: cookie,
				},
			}
		);

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
		const useLocalData = true;

		if (useLocalData) {
			res.status(200).json(localProjects);
			return;
		}

		const cookie = TICKTICK_API_COOKIE;
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

export default router;
