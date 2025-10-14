import express from 'express';
import FocusRecordTickTick from '../../models/FocusRecord';
import { verifyToken } from '../../middleware/verifyToken';
import { addAncestorAndCompletedTasks, fetchTickTickFocusRecords } from '../../utils/focus.utils';

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page as string) || 0;
		const limit = parseInt(req.query.limit as string) || 25;
		const skip = page * limit;
		const projects = req.query['projects-ticktick'] as string;
		const taskId = req.query['task-id'] as string;
		const startDate = req.query['start-date'] as string;
		const endDate = req.query['end-date'] as string;
		const sortBy = req.query['sort-by'] as string || 'Newest';
		const taskIdIncludeFocusRecordsFromSubtasks = req.query['task-id-include-focus-records-from-subtasks'] === 'true';
		const searchQuery = req.query['search'] as string;

		// Build regex filter for substring matching (case-insensitive)
		const searchFilter = searchQuery && searchQuery.trim() ? {
			$or: [
				{ note: { $regex: searchQuery.trim(), $options: 'i' } },
				{ tasks: { $elemMatch: { title: { $regex: searchQuery.trim(), $options: 'i' } } } },
				{ tasks: { $elemMatch: { projectName: { $regex: searchQuery.trim(), $options: 'i' } } } }
			]
		} : null;

		// Build list of project IDs to filter by
		const projectIds: string[] = projects ? projects.split(',') : [];
		const hasTaskOrProjectFilters = projectIds.length > 0 || !!taskId;

		// Build date range filter if provided
		const dateRangeFilter: any = {};
		if (startDate || endDate) {
			dateRangeFilter.startTime = {};
			if (startDate) {
				dateRangeFilter.startTime.$gte = new Date(startDate);
			}
			if (endDate) {
				// Add 1 day to endDate to include the entire end date
				const endDateTime = new Date(endDate);
				endDateTime.setDate(endDateTime.getDate() + 1);
				dateRangeFilter.startTime.$lt = endDateTime;
			}
		}

		// Build sort criteria based on sortBy parameter
		const getSortCriteria = (): { [key: string]: 1 | -1 } => {
			switch (sortBy) {
				case 'Oldest':
					return { startTime: 1 };
				case 'Focus Hours: Most-Least':
					return { duration: -1 };
				case 'Focus Hours: Least-Most':
					return { duration: 1 };
				case 'Newest':
				default:
					return { startTime: -1 };
			}
		};

		const sortCriteria = getSortCriteria();

		// If no task/project filters, use simple query (date filters can be applied directly)
		if (!hasTaskOrProjectFilters) {
			// Build aggregation pipeline for simple query with search support
			const simpleQueryPipeline: any[] = [];

			// Step 1: Apply search filter (regex substring match)
			if (searchFilter) {
				simpleQueryPipeline.push({ $match: searchFilter });
			}

			// Step 2: Apply date range filter
			if (Object.keys(dateRangeFilter).length > 0) {
				simpleQueryPipeline.push({ $match: dateRangeFilter });
			}

			// Step 3: Sort
			simpleQueryPipeline.push({ $sort: sortCriteria });

			// Step 4: Paginate
			simpleQueryPipeline.push({ $skip: skip });
			simpleQueryPipeline.push({ $limit: limit });

			const focusRecords = await FocusRecordTickTick.aggregate(simpleQueryPipeline);

			// Build count pipeline
			const countPipeline: any[] = [];
			if (searchFilter) {
				countPipeline.push({ $match: searchFilter });
			}

			if (Object.keys(dateRangeFilter).length > 0) {
				countPipeline.push({ $match: dateRangeFilter });
			}

			countPipeline.push({ $count: "total" });

			const countResult = await FocusRecordTickTick.aggregate(countPipeline);
			const total = countResult[0]?.total || 0;
			const totalPages = Math.ceil(total / limit);
			const hasMore = skip + focusRecords.length < total;

			// Calculate total durations for all focus records
			const durationPipeline: any[] = [];
			if (searchFilter) {
				durationPipeline.push({ $match: searchFilter });
			}

			// Add date range match stage if needed
			if (Object.keys(dateRangeFilter).length > 0) {
				durationPipeline.push({ $match: dateRangeFilter });
			}

			durationPipeline.push({
				$facet: {
					baseDuration: [
						{
							$group: {
								_id: null,
								total: { $sum: "$duration" }
							}
						}
					],
					tasksDuration: [
						{ $unwind: { path: "$tasks", preserveNullAndEmptyArrays: true } },
						{
							$group: {
								_id: null,
								total: { $sum: "$tasks.duration" }
							}
						}
					]
				}
			});

			const durationResult = await FocusRecordTickTick.aggregate(durationPipeline);

			const totalDuration = durationResult[0]?.baseDuration[0]?.total || 0;
			const onlyTasksTotalDuration = durationResult[0]?.tasksDuration[0]?.total || 0;

			// Add ancestor tasks and completed tasks
			const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords);

			return res.status(200).json({
				data: focusRecordsWithCompletedTasks,
				ancestorTasksById,
				total,
				totalPages,
				page,
				limit,
				hasMore,
				totalDuration,
				onlyTasksTotalDuration,
			});
		}

		// Build match and filter conditions
		const matchConditions: any = {};
		const filterConditions: any[] = [];

		// Add date range to match conditions
		if (startDate || endDate) {
			matchConditions.startTime = {};
			if (startDate) {
				matchConditions.startTime.$gte = new Date(startDate);
			}
			if (endDate) {
				// Add 1 day to endDate to include the entire end date
				const endDateTime = new Date(endDate);
				endDateTime.setDate(endDateTime.getDate() + 1);
				matchConditions.startTime.$lt = endDateTime;
			}
		}

		if (projectIds.length > 0) {
			matchConditions["tasks.projectId"] = { $in: projectIds };
			filterConditions.push({ $in: ["$$task.projectId", projectIds] });
		}

		if (taskId) {
			if (taskIdIncludeFocusRecordsFromSubtasks) {
				// Match if taskId equals task.taskId OR taskId is in task.ancestorIds (includes subtasks)
				matchConditions.$or = [
					{ "tasks.taskId": taskId },
					{ "tasks.ancestorIds": taskId }
				];
				filterConditions.push({
					$or: [
						{ $eq: ["$$task.taskId", taskId] },
						{ $in: [taskId, "$$task.ancestorIds"] }
					]
				});
			} else {
				// Match only if taskId equals task.taskId exactly (excludes subtasks)
				matchConditions["tasks.taskId"] = taskId;
				filterConditions.push({ $eq: ["$$task.taskId", taskId] });
			}
		}

		// Filter by project and/or task-id using denormalized data
		const aggregationPipeline: any[] = [];

		// Step 1: Apply search filter (regex substring match)
		if (searchFilter) {
			aggregationPipeline.push({ $match: searchFilter });
		}

		// Step 2: Match focus records that have at least one task matching the filters
		aggregationPipeline.push({ $match: matchConditions });

		// Step 3: Store original duration before filtering
		aggregationPipeline.push({
			$addFields: {
				originalDuration: "$duration"
			}
		});

		// Step 4: Filter tasks array to only include tasks matching ALL conditions
		aggregationPipeline.push({
			$addFields: {
				tasks: {
					$filter: {
						input: "$tasks",
						as: "task",
						cond: filterConditions.length > 1
							? { $and: filterConditions }
							: filterConditions[0]
					}
				}
			}
		});

		// Step 5: Recalculate duration based on filtered tasks
		aggregationPipeline.push({
			$addFields: {
				duration: {
					$reduce: {
						input: "$tasks",
						initialValue: 0,
						in: { $add: ["$$value", "$$this.duration"] }
					}
				}
			}
		});

		// Step 6: Sort
		aggregationPipeline.push({ $sort: sortCriteria });

		// Step 7: Paginate
		aggregationPipeline.push({ $skip: skip });
		aggregationPipeline.push({ $limit: limit });

		const focusRecords = await FocusRecordTickTick.aggregate(aggregationPipeline);

		// Count and total duration pipeline using denormalized data
		const countAndDurationPipeline: any[] = [];
		if (searchFilter) {
			countAndDurationPipeline.push({ $match: searchFilter });
		}

		// Match focus records that have at least one task matching the filters
		countAndDurationPipeline.push({ $match: matchConditions });

		// Store original duration before filtering
		countAndDurationPipeline.push({
			$addFields: {
				originalDuration: "$duration"
			}
		});

		// Filter tasks array to only include tasks matching ALL conditions
		countAndDurationPipeline.push({
			$addFields: {
				filteredTasks: {
					$filter: {
						input: "$tasks",
						as: "task",
						cond: filterConditions.length > 1
							? { $and: filterConditions }
							: filterConditions[0]
					}
				}
			}
		});

		// Calculate filtered tasks duration
		countAndDurationPipeline.push({
			$addFields: {
				filteredTasksDuration: {
					$reduce: {
						input: "$filteredTasks",
						initialValue: 0,
						in: { $add: ["$$value", "$$this.duration"] }
					}
				}
			}
		});

		// Group to get totals
		countAndDurationPipeline.push({
			$group: {
				_id: null,
				total: { $sum: 1 },
				totalDuration: { $sum: "$originalDuration" },
				onlyTasksTotalDuration: { $sum: "$filteredTasksDuration" }
			}
		});

		const countAndDurationResult = await FocusRecordTickTick.aggregate(countAndDurationPipeline);
		const total = countAndDurationResult[0]?.total || 0;
		const totalDuration = countAndDurationResult[0]?.totalDuration || 0;
		const onlyTasksTotalDuration = countAndDurationResult[0]?.onlyTasksTotalDuration || 0;
		const totalPages = Math.ceil(total / limit);
		const hasMore = skip + focusRecords.length < total;

		// Add ancestor tasks and completed tasks
		const { focusRecordsWithCompletedTasks, ancestorTasksById } = await addAncestorAndCompletedTasks(focusRecords);

		res.status(200).json({
			data: focusRecordsWithCompletedTasks,
			ancestorTasksById,
			total,
			totalPages,
			page,
			limit,
			hasMore,
			totalDuration,
			onlyTasksTotalDuration,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records.',
		});
	}
});

router.get('/test-json-data', verifyToken, async (req, res) => {
	try {
		const todayOnly = req.query.today === 'true';

		const sortedAllFocusData = await fetchTickTickFocusRecords({
			todayOnly,
			doNotUseMongoDB: false,
		});

		res.status(200).json(sortedAllFocusData);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records from TickTick API.',
		});
	}
});

export default router;
