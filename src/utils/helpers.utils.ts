import { Types } from 'mongoose';
import SyncMetadata from "../models/SyncMetadataModel";
import UserSettings from "../models/UserSettingsModel";
import { crossesMidnightInTimezone } from "./timezone.utils";
import { decrypt } from "./encryption.utils";

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

/**
 * Parses the string of TIDE app Focus Records. I had to manually take screenshots on my Mac and copy and paste that text into a file because the API wasn't giving me everything I needed. So, that big string I created in "MY_DATA.txt" needed to be parsed using this function. Keeping this function here historical purposes.
 * @param {String} input
 * @returns {Array<Object>}
 */
export const parseTideFocusRecordsString = (input: String) => {
	const lines = input.split('\n');
	const records: any = [];
	let current: any = {};

	lines.forEach((line) => {
		if (line.trim()) {
			// Skip empty lines
			if (line.includes('/')) {
				// Checks for date line
				current.startTime = line.trim();
			} else if (line.includes('m') || line.includes('h')) {
				// Checks for duration line
				current.duration = line.trim();
				records.push(current);
				current = {};
			} else {
				// This should be the name line
				current.name = line.trim();
			}
		}
	});

	return records;
};

// For the "BeFocused" app focus records and their "Start date" property which is not JS friendly with the "  at " portion of it.
export const getBeFocusedFocusRecordsWithValidDate = (array: any) => {
	return array.map((item: any) => {
		// Check if 'Start date' exists in the object
		if (item['Start date']) {
			// Replace double spaces with a single space
			let cleanedDate = item['Start date'].replace(/\s{2,}/g, ' ');

			// Convert the cleaned date string into a more standard date string
			// Assuming 'Oct 15 2021 at 4:11:32 PM' is the format after cleaning
			cleanedDate = cleanedDate.replace(' at ', ' ');

			// Create a new Date object from the cleaned date string
			const dateObject = new Date(cleanedDate);

			// Convert the Date object to an ISO string or any preferred format
			item['Start date'] = dateObject.toISOString();
		}
		return item;
	});
};

// Helper function to get or create sync metadata
export async function getOrCreateSyncMetadata(userId: Types.ObjectId, syncType: string) {
	// Use findOne first to avoid creating unnecessary documents
	let syncMetadata = await SyncMetadata.findOne({ userId, syncType });

	if (!syncMetadata) {
		// Create in-memory document but don't save yet
		// This prevents saving epoch date when sync fails
		syncMetadata = new SyncMetadata({
			userId,
			syncType,
			lastSyncTime: new Date(0), // Set to epoch so all data is synced initially
		});
	}

	return syncMetadata;
}

// Helper function to get user's TickTick cookie with validation
export async function getTickTickCookie(userId: Types.ObjectId): Promise<string> {
	const userSettings = await UserSettings.findOne({ userId });
	const encryptedCookie = userSettings?.tickTickCookie;

	if (!encryptedCookie) {
		throw new Error('TickTick cookie not set. Please add your TickTick cookie in settings.');
	}

	// Decrypt the cookie before returning it
	const decryptedCookie = decrypt(encryptedCookie);

	return decryptedCookie;
}

/**
 * Wraps axios calls to TickTick API and extracts meaningful error messages
 * from TickTick's error response structure
 */
export async function handleTickTickApiCall<T>(apiCall: () => Promise<T>): Promise<T> {
	try {
		return await apiCall();
	} catch (error: any) {
		// Check if this is an axios error with a response from TickTick
		if (error?.response?.data?.errorMessage) {
			// Create error with TickTick's message and preserve status code
			const tickTickError: any = new Error(error.response.data.errorMessage);
			tickTickError.statusCode = error.response.status;
			throw tickTickError;
		}
		// Fallback to original error
		throw error;
	}
}

/**
 * Helper function to check if a record crosses midnight with caching
 * @param startTime - Start time of the record
 * @param endTime - End time of the record
 * @param timezone - User's timezone
 * @param cache - Map to cache results
 * @returns boolean indicating if record crosses midnight
 */
export function getCachedCrossesMidnight(
	startTime: Date,
	endTime: Date,
	timezone: string,
	cache: Map<string, boolean>
): boolean {
	const startDay = Math.floor(startTime.getTime() / 86400000);
	const endDay = Math.floor(endTime.getTime() / 86400000);
	const dateKey = `${timezone}_${startDay}_${endDay}`;

	let crossesMidnight = cache.get(dateKey);
	if (crossesMidnight === undefined) {
		crossesMidnight = crossesMidnightInTimezone(startTime, endTime, timezone);
		cache.set(dateKey, crossesMidnight);
	}

	return crossesMidnight;
}