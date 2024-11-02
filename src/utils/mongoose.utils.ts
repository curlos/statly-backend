import { allProjects } from '../focus-data/allProjects';
import { allTags } from '../focus-data/allTags';
import { allTasks } from '../focus-data/allTasks';
import { completedTasksFromArchivedProjects } from '../focus-data/archivedTasks/completedTasksFromArchivedProjects';
import { notCompletedTasksFromArchivedProjects } from '../focus-data/archivedTasks/notCompletedTasksFromArchivedProjects';
import { sortedAllFocusData } from '../focus-data/sortedAllFocusData';
import JsonData from '../models/JsonData';

export const updateLocalData = async () => {
	const datasets = [
		{ name: 'Sorted All Focus Data', data: sortedAllFocusData },
		{ name: 'All Tasks', data: allTasks },
		{ name: 'All Projects', data: allProjects },
		{ name: 'Completed Tasks from Archived Projects', data: completedTasksFromArchivedProjects },
		{ name: 'Not Completed Tasks from Archived Projects', data: notCompletedTasksFromArchivedProjects },
		{ name: 'All Tags', data: allTags },
	];

	// Create an array of promises using map
	const updatePromises = datasets.map((dataset) => updateLocalJsonData(dataset));

	// Wait for all promises to resolve using Promise.all
	try {
		const results = await Promise.all(updatePromises);
		console.log('All datasets updated successfully:', results);
	} catch (error) {
		console.error('Failed to update one or more datasets:', error);
	}
};

// Function to update or create a new document
export const updateLocalJsonData = async (dataset: { name: any; data: any }) => {
	try {
		const result = await JsonData.findOneAndUpdate(
			{ name: dataset.name },
			{ $set: { data: dataset.data, updatedAt: new Date() } },
			{ new: true, upsert: true, useFindAndModify: false }
		);
		console.log(`Document for ${dataset.name} updated or created successfully:`, result);

		return result;
	} catch (error) {
		console.error('Error updating or creating document:', error);
	}
};
