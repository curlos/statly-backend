export const sortArrayByProperty = (array: any[], property: string, type = 'descending') => {
	// Create a deep copy of the array to avoid modifying the original
	const arrayCopy = array.map((item: any) => ({ ...item }));

	if (type === 'descending') {
		return arrayCopy.sort(
			(a: { [x: string]: any }, b: { [x: string]: any }) =>
				new Date(b[property]).getTime() - new Date(a[property]).getTime()
		);
	}

	return arrayCopy.sort(
		(a: { [x: string]: any }, b: { [x: string]: any }) =>
			new Date(a[property]).getTime() - new Date(b[property]).getTime()
	);
};

// Function to format date as YYYY-MM-DD
export const formatDate = (date: Date) => {
	const year = date.getFullYear();
	const month = (date.getMonth() + 1).toString().padStart(2, '0'); // Add 1 because months are zero-indexed
	const day = date.getDate().toString().padStart(2, '0');
	return `${year}-${month}-${day}`;
};

// Function to get today and the next day
export const getDayAfterToday = () => {
	const today = new Date(); // Today's date
	const dayAfterToday = new Date(today); // Copy today's date
	dayAfterToday.setDate(today.getDate() + 1); // Increment the day by one

	return formatDate(dayAfterToday);
};

/**
 * @description Chunks the passed in array into N arrays. This is very useful for splitting up the large local data I have stored into smaller arrays. This is necessary because TypeScript can't infer types on large data sets with thousands lines of code (the tasks array has 125,000 lines of code by itself).
 */
const chunkIntoN = (arr: any, n: any) => {
	const size = Math.ceil(arr.length / n);
	return Array.from({ length: n }, (v, i) => arr.slice(i * size, i * size + size));
};

// const chunkedArrays = chunkIntoN(allTasks, 20);

// Helper function to get start and end of the day in ms
export const getTodayTimeBounds = () => {
	const now = new Date();
	const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, -1);
	return { startMs: startOfDay.getTime(), endMs: endOfDay.getTime() };
};

/**
 * Transforms an array of objects into an object with keys based on a specified property.
 * @param {Object[]} array - The array of objects to transform.
 * @param {string} keyProperty - The property of the objects to use as keys in the resulting object.
 * @returns {Object} An object with keys derived from each object's specified property and values as the objects themselves.
 */
export function arrayToObjectByKey(array: any[], keyProperty: string) {
	return array.reduce((acc, obj) => {
		// Use the value of the specified property as the key
		const key = keyProperty ? obj[keyProperty] : obj;
		// Assign the entire object as the value for this key
		acc[key] = obj;
		return acc;
	}, {});
}
