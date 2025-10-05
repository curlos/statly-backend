import { Task } from '../models/TaskModel';

// Helper function to build ancestor data for tasks (optimized with pre-computed ancestorIds)
export async function buildAncestorData(tasks: any[]) {
	// Step 1: Collect ALL unique ancestor IDs from tasks (using pre-computed ancestorIds)
	const allAncestorIds = new Set<string>();

	tasks.forEach(task => {
		if (task.ancestorIds && task.ancestorIds.length > 0) {
			// Optimization: If we've seen an ancestor in the chain, we've seen all above it
			for (const ancestorId of task.ancestorIds) {
				if (allAncestorIds.has(ancestorId)) {
					break; // Skip the rest - we've already added this ancestor chain
				}
				allAncestorIds.add(ancestorId);
			}
		}
	});

	// Step 2: Fetch ALL ancestor tasks in ONE batch query
	const ancestorTasks = await Task.find({
		id: { $in: Array.from(allAncestorIds) }
	}).lean();

	// Step 3: Build ancestorTasksById map
	const ancestorTasksById: Record<string, { id: string; title: string; parentId: string | null; }> = {};
	ancestorTasks.forEach(task => {
		ancestorTasksById[task.id] = {
			id: task.id,
			title: task.title,
			parentId: task.parentId ?? null
		};
	});

	return { ancestorTasksById };
}
