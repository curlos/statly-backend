// Medal configuration types
export interface FocusMedal {
	name: string;
	requiredDuration: number;
	interval: string;
}

export interface TaskMedal {
	name: string;
	requiredCompletedTasks: number;
	interval: string;
}

export type Medal = FocusMedal | TaskMedal;

// Medal result types
export interface MedalResult {
	type: 'focus' | 'tasks';
	intervalsEarned: string[];
}

export type MedalResults = Record<string, MedalResult>;
