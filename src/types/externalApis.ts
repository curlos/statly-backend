// TickTick API response types
export interface TickTickTaskRaw {
	id: string;
	title: string;
	content?: string;
	projectId?: string;
	parentId?: string;
	completedTime?: string;
	modifiedTime?: string;
	createdTime?: string;
	sortOrder?: number;
	timeZone?: string;
	[key: string]: unknown; // Allow additional fields
}

export interface TickTickFocusRecordRaw {
	id: string;
	startTime: string;
	endTime: string;
	pauseDuration?: number;
	note?: string;
	trackingMode?: 'pomodoro' | 'stopwatch';
	tasks?: Array<{
		taskId: string;
		title: string;
		startTime: string;
		endTime: string;
		duration: number;
		projectId?: string;
		projectName?: string;
		ancestorIds?: string[];
	}>;
	[key: string]: unknown;
}

// Todoist API response types
export interface TodoistTaskRaw {
	id: string;
	content: string;
	description?: string;
	project_id?: string;
	parent_id?: string;
	completed_at?: string;
	created_at?: string;
	[key: string]: unknown;
}

// BeFocused app format
export interface BeFocusedRecordRaw {
	'Start date': string;
	'End date'?: string;
	Duration?: string;
	name?: string;
	[key: string]: unknown;
}

// Forest app format
export interface ForestRecordRaw {
	startTime: string;
	endTime?: string;
	duration?: number;
	tag?: string;
	note?: string;
	[key: string]: unknown;
}

// Tide app format
export interface TideRecordRaw {
	startTime: string;
	endTime?: string;
	duration?: number;
	[key: string]: unknown;
}

// Session app format
export interface SessionRecordRaw {
	id: string;
	startTime: string;
	endTime: string;
	duration?: number;
	note?: string;
	pauseDuration?: number;
	tasks?: Array<{
		taskId: string;
		title: string;
		startTime: string;
		endTime: string;
		duration: number;
	}>;
	[key: string]: unknown;
}
