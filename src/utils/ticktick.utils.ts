import axios from 'axios';
import { getDayAfterToday } from './helpers.utils';
import dotenv from 'dotenv';

dotenv.config();

const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;

export async function fetchActiveAndCompletedTasksFromTickTick(projectIds: string[]) {
	const dayAfterTodayStr = getDayAfterToday();

	// Build all API call promises (2 per project: active + completed)
	const allPromises = projectIds.flatMap((projectId) => [
		// Active tasks
		axios.get(
			`https://api.ticktick.com/api/v2/project/${projectId}/tasks`,
			{
				headers: {
					Cookie: cookie,
				},
			}
		),
		// Completed tasks
		axios.get(
			`https://api.ticktick.com/api/v2/project/${projectId}/completed/?from=&to=${dayAfterTodayStr}%2016:59:12&limit=9999`,
			{
				headers: {
					Cookie: cookie,
				},
			}
		)
	]);

	// Execute all API calls in parallel
	const responses = await Promise.all(allPromises);

	// Flatten all response data into a single tasks array
	const tasks = responses.flatMap(response => response.data);

	return tasks;
}

export async function fetchAllTickTickTasks(options?: {
	archivedProjectIds?: string[];
	getTasksFromNonArchivedProjects?: boolean;
}) {
	let regularTasks: any[] = [];

	// Only fetch regular tasks if getTasksFromNonArchivedProjects is true (default)
	const shouldGetRegularTasks = options?.getTasksFromNonArchivedProjects ?? true;

	if (shouldGetRegularTasks) {
		const dayAfterTodayStr = getDayAfterToday();

		const [batchCheckResponse, completedTasksResponse, willNotDoTasksResponse, trashTasksResponse] = await Promise.all([
			axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
				headers: {
					Cookie: cookie,
					'x-device': JSON.stringify({
						platform: 'web'
					}),
				},
			}),
			axios.get(
				`https://api.ticktick.com/api/v2/project/all/completedInAll/?from=&to=${dayAfterTodayStr}%2010:50:58&limit=20000&=`,
				{
					headers: {
						Cookie: cookie,
					},
				}
			),
			axios.get(
				`https://api.ticktick.com/api/v2/project/all/closed/?from=&to=${dayAfterTodayStr}%2010:50:58&limit=20000&=&status=Abandoned`,
				{
					headers: {
						Cookie: cookie,
					},
				}
			),
			axios.get(
				`https://api.ticktick.com/api/v2/project/all/trash/page?limit=9999999`,
				{
					headers: {
						Cookie: cookie,
					},
				}
			)
		]);

		const tasksToBeUpdated = batchCheckResponse.data.syncTaskBean.update;
		const completedTasks = completedTasksResponse.data;
		const willNotDoTasks = willNotDoTasksResponse.data;
		const { tasks: trashTasks } = trashTasksResponse.data;

		regularTasks = [
			...tasksToBeUpdated,
			...completedTasks,
			...willNotDoTasks,
			...trashTasks,
		];
	}

	// If archived project IDs provided, fetch their tasks
	let archivedTasks: any[] = [];
	if (options?.archivedProjectIds && options.archivedProjectIds.length > 0) {
		archivedTasks = await fetchActiveAndCompletedTasksFromTickTick(options.archivedProjectIds);
	}

	return [...regularTasks, ...archivedTasks];
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
