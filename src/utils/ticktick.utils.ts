import axios from 'axios';
import { getDayAfterToday, handleTickTickApiCall } from './helpers.utils';
import { ITask } from '../models/TaskModel';

export async function fetchActiveAndCompletedTasksFromTickTick(projectIds: string[], cookie: string): Promise<ITask[]> {
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
	const responses = await handleTickTickApiCall(() => Promise.all(allPromises));

	// Flatten all response data into a single tasks array
	const tasks = responses.flatMap(response => response.data);

	return tasks;
}

export async function fetchAllTickTickTasks(cookie: string, options?: {
	archivedProjectIds?: string[];
	getTasksFromNonArchivedProjects?: boolean;
}): Promise<ITask[]> {
	let regularTasks: ITask[] = [];

	// Only fetch regular tasks if getTasksFromNonArchivedProjects is true (default)
	const shouldGetRegularTasks = options?.getTasksFromNonArchivedProjects ?? true;

	if (shouldGetRegularTasks) {
		const dayAfterTodayStr = getDayAfterToday();

		const [batchCheckResponse, completedTasksResponse, willNotDoTasksResponse, trashTasksResponse] = await handleTickTickApiCall(() => Promise.all([
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
		]));

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
	let archivedTasks: ITask[] = [];
	if (options?.archivedProjectIds && options.archivedProjectIds.length > 0) {
		archivedTasks = await fetchActiveAndCompletedTasksFromTickTick(options.archivedProjectIds, cookie);
	}

	return [...regularTasks, ...archivedTasks];
}

export async function fetchAllTickTickProjects(cookie: string) {
	const batchCheckResponse = await handleTickTickApiCall(() =>
		axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
			headers: {
				Cookie: cookie,
				'x-device': JSON.stringify({
					platform: 'web'
				}),
			},
		})
	);

	const projects = batchCheckResponse.data.projectProfiles || [];
	return projects;
}

export async function fetchAllTickTickProjectGroups(cookie: string) {
	const batchCheckResponse = await handleTickTickApiCall(() =>
		axios.get('https://api.ticktick.com/api/v2/batch/check/0', {
			headers: {
				Cookie: cookie,
				'x-device': JSON.stringify({
					platform: 'web'
				}),
			},
		})
	);

	const projectGroups = batchCheckResponse.data.projectGroups || [];
	return projectGroups;
}
