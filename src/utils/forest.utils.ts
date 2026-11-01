interface ForestTask {
	projectId?: string | null;
	duration?: number;
}

// The time in a record's tasks for each project, in the order the projects first appear. Tasks without a project are grouped under ''. This is how the stats page adds up time per project, from each task's own duration.
export function getProjectSeconds(tasks: ForestTask[] | undefined) {
	const secondsByProject = new Map<string, number>();

	for (const task of tasks || []) {
		const projectId = task.projectId || '';
		secondsByProject.set(projectId, (secondsByProject.get(projectId) || 0) + (task.duration || 0));
	}

	return secondsByProject;
}

// The project with the most time among a record's tasks, which decides the record's tree. The first project wins a tie, and a project of '' means the record has no project.
export function getTopProject(tasks: ForestTask[] | undefined) {
	const secondsByProject = getProjectSeconds(tasks);

	// Map keeps insertion order and only a strictly greater time replaces the leader, so ties go to the first project.
	let topProjectId = '';
	let topSeconds = 0;
	let hasLeader = false;
	for (const [projectId, seconds] of secondsByProject) {
		if (!hasLeader || seconds > topSeconds) {
			topProjectId = projectId;
			topSeconds = seconds;
			hasLeader = true;
		}
	}

	return { projectId: topProjectId, seconds: topSeconds };
}
