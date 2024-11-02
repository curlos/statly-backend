// src/routes/taskRouter.ts
import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

import { getTodayTimeBounds, sortArrayByProperty, getDayAfterToday } from '../../utils/helpers.utils';

const router = express.Router();
const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;

const localFocusData = [{}];
const localTasks = [{}];
const localProjects = [{}];
const localTags = [{}];

// new Date(2705792451783) = September 28, 2055. This is to make sure all my tasks are fetched properly. I doubt I'll have to worry about this expiring since I'll be long past TickTick and humans coding anything will be a thing of the past by then with GPT-20 out by then.
const farAwayDateInMs = 2705792451783;

const useLocalData = false;

router.get('/focus-records', async (req, res) => {
	try {
		const todayOnly = req.query.today === 'true';
		const last30DaysOnly = req.query.last30Days === 'true';

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
		} else if (last30DaysOnly) {
			const today = new Date();
			const thirtyDaysAgo = new Date(today.setDate(today.getDate() - 30));
			fromMs = thirtyDaysAgo.getTime();
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

		let allFocusData = [...focusDataPomos.data, ...focusDataStopwatch.data];

		if (last30DaysOnly) {
			const fromMsDate = new Date(fromMs);
			// Get the local focus records that have occurred after "fromMs"
			const localFocusDataBefore30Days = localFocusData.filter(
				(focusRecord: any) => new Date(focusRecord.startTime) <= fromMsDate
			);
			allFocusData.push(...localFocusDataBefore30Days);
		}

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
			// ...completedTasksFromArchivedProjects,
			// ...notCompletedTasksFromArchivedProjects,
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

export default router;
