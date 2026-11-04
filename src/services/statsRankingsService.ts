import { Types } from 'mongoose';
import { BaseQueryParams } from '../utils/queryParams.utils';
import { getFocusRecordsStats } from './statsFocusService';
import { getCompletedTasksStats } from './statsTaskService';

export type RankingType = 'tasks' | 'focus';
export type RankingInterval = 'day' | 'week' | 'month' | 'year';
export type RankingSort = 'most' | 'least';

export interface IntervalRankingsQueryParams extends BaseQueryParams {
	type: RankingType;
	interval: RankingInterval;
	sort: RankingSort;
	page: number;
	limit: number;
}

export interface RankingItem {
	date: string;
	count: number;
	duration?: number;
}

const RESULT_KEY_BY_INTERVAL: Record<RankingInterval, string> = {
	day: 'byDay',
	week: 'byWeek',
	month: 'byMonth',
	year: 'byYear',
};

// Sorts intervals by value, then by count (most or least first), with ties going to the more recent interval; returns one page.
export function rankIntervals(
	items: RankingItem[],
	sortKey: 'count' | 'duration',
	page: number,
	limit: number,
	sort: RankingSort = 'most'
) {
	const direction = sort === 'least' ? -1 : 1;
	// Focus time is compared in whole minutes (what the card shows), so 10h0m5s and 10h0m40s tie
	const value = (item: RankingItem) => (sortKey === 'duration' ? Math.floor((item.duration ?? 0) / 60) : item.count);
	const sorted = [...items].sort(
		(a, b) =>
			direction * (value(b) - value(a)) ||
			direction * (b.count - a.count) ||
			Date.parse(b.date) - Date.parse(a.date)
	);

	const startIndex = (page - 1) * limit;
	const rankings = sorted.slice(startIndex, startIndex + limit).map((item, index) => ({
		rank: startIndex + index + 1,
		...item,
	}));

	return {
		rankings,
		page,
		totalPages: Math.ceil(sorted.length / limit),
		totalItems: sorted.length,
	};
}

// Ranks days/weeks/months/years by completed tasks or focus time, reusing the existing stats grouping.
export async function getIntervalRankings(params: IntervalRankingsQueryParams, userId: Types.ObjectId) {
	const { type, interval, sort, page, limit, ...baseParams } = params;
	const resultKey = RESULT_KEY_BY_INTERVAL[interval];

	if (type === 'focus') {
		const result = await getFocusRecordsStats({ ...baseParams, groupBy: interval }, userId);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const items: RankingItem[] = ((result as any)[resultKey] || []).map((r: any) => ({
			date: r.date,
			count: r.count,
			duration: r.duration,
		}));
		return rankIntervals(items, 'duration', page, limit, sort);
	}

	const result = await getCompletedTasksStats(
		{ ...baseParams, taskIdIncludeSubtasks: baseParams.taskIdIncludeFocusRecordsFromSubtasks, groupBy: interval },
		userId
	);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const items: RankingItem[] = ((result as any)[resultKey] || []).map((r: any) => ({
		date: r.date,
		count: r.count,
	}));
	return rankIntervals(items, 'count', page, limit, sort);
}
