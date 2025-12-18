// Todoist API sync response types
export interface TodoistSyncTask {
	id: string;
	content: string;
	project_id?: string;
	parent_id?: string;
	completed_at?: string;
	created_at?: string;
	[key: string]: unknown;
}

export type TodoistSyncTasksById = Record<string, TodoistSyncTask>;

// Todoist API v1 response types
export interface TodoistApiV1Task {
	id: string;
	content: string;
	project_id?: string;
	parent_id?: string;
	[key: string]: unknown;
}

export type TodoistApiV1TasksById = Record<string, TodoistApiV1Task>;
