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
