import express from 'express';
import axios from 'axios';
import dotenv from 'dotenv';
import { getDayAfterToday } from '../../utils/helpers.utils';
// import { updateLocalData } from '../../utils/mongoose.utils';

const router = express.Router();

const SERVER_URL = process.env.SERVER_URL;

const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;

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

/**
 * @description Temporary function that was only used once to update MongoDB with the JSON data I manually copied and pasted from TickTick 1.0. This won't be necessary anymore - or at least it shouldn't be since the data will be stored on the DB from now on BUT just in case, will keep this here.
 */
router.put('/update-local-data', async (req, res) => {
	try {
		// await updateLocalData();
		res.status(200).json('Updated all local data!');
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the external data.',
		});
	}
});

export default router;
