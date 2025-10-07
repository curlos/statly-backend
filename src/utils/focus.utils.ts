import axios from 'axios';
import { getTodayTimeBounds, sortArrayByProperty, arrayToObjectByKey } from './helpers.utils';
import { getJsonData } from './mongoose.utils';

const TICKTICK_API_COOKIE = process.env.TICKTICK_API_COOKIE;
const cookie = TICKTICK_API_COOKIE;
// new Date(2705792451783) = September 28, 2055. This is to make sure all my tasks are fetched properly. I doubt I'll have to worry about this expiring since I'll be long past TickTick and humans coding anything will be a thing of the past by then with GPT-20 out by then.
const farAwayDateInMs = 2705792451783;

interface FetchFocusRecordsOptions {
	todayOnly?: boolean;
	doNotUseMongoDB?: boolean;
	localSortedAllFocusData?: any;
}

export const fetchTickTickFocusRecords = async (options: FetchFocusRecordsOptions = {}) => {
	const { todayOnly = false, doNotUseMongoDB = false, localSortedAllFocusData = {} } = options;

	const localFocusData = doNotUseMongoDB ? localSortedAllFocusData : await getJsonData('sorted-all-focus-data');

	let fromMs = 0;
	let toMs = farAwayDateInMs;

	if (todayOnly) {
		const { startMs, endMs } = getTodayTimeBounds();
		fromMs = startMs;
		toMs = endMs;
	} else {
		// Get the local focus data from MongoDB and since the focus records are already sorted by startTime, get the very first focus record in the array and get it's startTime and set the "toMs" variable to that startTime in MS - 1 ms.
		const semiRecentFocusRecord = localFocusData[20];
		const semiRecentStartTimeDate = new Date(semiRecentFocusRecord.startTime);
		const semiRecentStartTimeInMs = semiRecentStartTimeDate.getTime();

		const todayMs = new Date().getTime();

		// Subtract 1 MS to not include latest focus record in our search.
		fromMs = semiRecentStartTimeInMs;
		toMs = todayMs;
	}

	const focusDataPomos = await axios.get(`https://api.ticktick.com/api/v2/pomodoros?from=${fromMs}&to=${toMs}`, {
		headers: {
			Cookie: cookie,
		},
	});

	const focusDataStopwatch = await axios.get(
		`https://api.ticktick.com/api/v2/pomodoros/timing?from=${fromMs}&to=${toMs}`,
		{
			headers: {
				Cookie: cookie,
			},
		}
	);

	const tickTickOneApiFocusData = [...focusDataPomos.data, ...focusDataStopwatch.data];
	const tickTickOneApiFocusDataById = arrayToObjectByKey(tickTickOneApiFocusData, 'id');
	const localFocusDataById = arrayToObjectByKey(localFocusData, 'id');

	// This is necessary and I can't just check to add focus records that are already in the DB like I did before because I often times edit my focus record after it's been created by updating the focus note. So, if I don't have this logic, then I won't have the latest focus note logic. I'm probably re-writing through around 20 focus records.
	const localFocusDataWithLatestInfo = localFocusData.map((focusRecord: any) => {
		const focusRecordFromApi = tickTickOneApiFocusDataById[focusRecord.id];

		if (focusRecordFromApi) {
			return focusRecordFromApi;
		}

		return focusRecord;
	});

	// Filter out any focus records that are already stored in the database from the API's returned focus records.
	const tickTickOneApiFocusDataNoDupes = tickTickOneApiFocusData.filter((focusData) => {
		const isNotAlreadyInDatabase = localFocusDataById[focusData.id];
		return !isNotAlreadyInDatabase;
	});

	const allFocusData = [...tickTickOneApiFocusDataNoDupes, ...localFocusDataWithLatestInfo];
	const sortedAllFocusData = sortArrayByProperty(allFocusData, 'startTime');

	return sortedAllFocusData;
};
