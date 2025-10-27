import Task from '../models/TaskModel';
import Project from '../models/projectModel';

// ============================================================================
// Overview Stats Service
// ============================================================================

export interface OverviewStats {
	numOfAllTasks: number;
	numOfCompletedTasks: number;
	numOfProjects: number;
	numOfDaysSinceAccountCreated: number;
}

/**
 * Get overview statistics including task counts, project counts, and account age
 */
export async function getOverviewStats(): Promise<OverviewStats> {
	// Account created date (hardcoded as per requirement)
	const accountCreatedDate = new Date('2020-11-02');
	const today = new Date();
	const timeDiff = today.getTime() - accountCreatedDate.getTime();
	const numOfDaysSinceAccountCreated = Math.floor(timeDiff / (1000 * 60 * 60 * 24));

	// Count all tasks
	const numOfAllTasks = await Task.countDocuments();

	// Count completed tasks (tasks with completedTime set)
	const numOfCompletedTasks = await Task.countDocuments({
		completedTime: { $exists: true, $ne: null }
	});

	// Count all projects
	const numOfProjects = await Project.countDocuments();

	return {
		numOfAllTasks,
		numOfCompletedTasks,
		numOfProjects,
		numOfDaysSinceAccountCreated
	};
}
