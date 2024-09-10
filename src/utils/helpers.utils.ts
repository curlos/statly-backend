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

/**
 * @description Chunks the passed in array into N arrays. This is very useful for splitting up the large local data I have stored into smaller arrays. This is necessary because TypeScript can't infer types on large data sets with thousands lines of code (the tasks array has 125,000 lines of code by itself).
 */
const chunkIntoN = (arr: any, n: any) => {
	const size = Math.ceil(arr.length / n);
	return Array.from({ length: n }, (v, i) => arr.slice(i * size, i * size + size));
};

// const chunkedArrays = chunkIntoN(allTasks, 20);
