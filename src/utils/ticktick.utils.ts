import axios from 'axios';
import { getDayAfterToday } from './helpers.utils';
import { getJsonData } from './mongoose.utils';
import dotenv from 'dotenv';

dotenv.config();

const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;

export async function fetchAllTickTickTasks() {
	const dayAfterTodayStr = getDayAfterToday();

	const batchCheckResponse = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
		headers: {
			Cookie: cookie,
			'x-device': JSON.stringify({
				platform: 'web'
			}),
		},
	});

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

	const completedTasksFromArchivedProjects = await getJsonData('completed-tasks-from-archived-projects');
	const notCompletedTasksFromArchivedProjects = await getJsonData('not-completed-tasks-from-archived-projects');

	const tickTickOneTasks = [
		...tasksToBeUpdated,
		...completedTasks,
		...willNotDoTasks,
		...trashTasks,
		...completedTasksFromArchivedProjects,
		...notCompletedTasksFromArchivedProjects
	];

	return tickTickOneTasks;
}

export async function fetchAllTickTickProjects() {
	const batchCheckResponse = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
		headers: {
			Cookie: cookie,
			'x-device': JSON.stringify({
				platform: 'web'
			}),
		},
	});

	const projects = batchCheckResponse.data.projectProfiles || [];
	return projects;
}

export async function fetchAllTickTickProjectGroups() {
	const batchCheckResponse = await axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
		headers: {
			Cookie: cookie,
			'x-device': JSON.stringify({
				platform: 'web'
			}),
		},
	});

	const projectGroups = batchCheckResponse.data.projectGroups || [];
	return projectGroups;
}
