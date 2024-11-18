import JsonData from '../models/JsonData';

export const updateLocalData = async (dataSets: any) => {
	// Create an array of promises using map
	const updatePromises = dataSets.map((dataset: any) => updateLocalJsonData(dataset));

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

// Function to retrieve data by name from MongoDB
export const getJsonData = async (name: any) => {
	try {
		const result = await JsonData.findOne({ name: name });
		if (!result) {
			throw new Error(`No document found with the name ${name}`);
		}
		return result.data;
	} catch (error) {
		console.error('Error retrieving document:', error);
		throw error; // Re-throw to handle it in the calling context
	}
};
