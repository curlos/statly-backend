import express from 'express';
import { randomUUID } from 'crypto';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { verifyToken } from '../../middleware/verifyToken';
import SyncMetadata from '../../models/SyncMetadataModel';
import { TaskTodoist } from '../../models/TaskModel';
import { getAllTodoistTasks } from '../../utils/task.utils';
import { syncTickTickTasks, syncTickTickProjects, syncTickTickProjectGroups, syncTickTickFocusRecords, syncTodoistProjects } from '../../utils/sync.utils';
import { fetchBeFocusedAppFocusRecords, fetchForestAppFocusRecords, fetchTideAppFocusRecords, fetchSessionFocusRecordsWithNoBreaks } from '../../utils/focus.utils';
import { FocusRecordBeFocused, FocusRecordForest, FocusRecordTide, FocusRecordSession } from '../../models/FocusRecord';
import { ProjectSession } from '../../models/projectModel';
import { crossesMidnightInTimezone } from '../../utils/timezone.utils';

const router = express.Router();

router.get('/metadata', verifyToken, async (req, res) => {
    try {
        const syncMetadata = await SyncMetadata.find({})

        if (!syncMetadata) {
            return res.status(404).json({
                message: 'No sync metadata found',
            });
        }

        // Transform array to object keyed by syncType
        const syncMetadataByType = syncMetadata.reduce((acc: any, metadata: any) => {
            acc[metadata.syncType] = metadata;
            return acc;
        }, {});

        res.status(200).json(syncMetadataByType);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred fetching sync metadata.',
        });
    }
});

router.post('/ticktick/tasks', verifyToken, async (req: CustomRequest, res) => {
    try {
        const result = await syncTickTickTasks(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred transferring tasks.',
        });
    }
});

router.post('/todoist/tasks', verifyToken, async (req: CustomRequest, res) => {
    try {
        // Get or create sync metadata for todoist tasks
        let syncMetadata = await SyncMetadata.findOne({ syncType: 'todoist_tasks' });

        if (!syncMetadata) {
            syncMetadata = new SyncMetadata({
                userId: req.user!.userId,
                syncType: 'todoist_tasks',
                lastSyncTime: new Date(0), // Set to epoch so all tasks are synced initially
            });
        }

        const allTasks = await getAllTodoistTasks();

        // Step 1: Build tasksById map for quick parent lookups
        const tasksById: Record<string, any> = {};
        allTasks.forEach((task: any) => {
            const taskId = task.v2_id || task.id
            tasksById[taskId] = task;
        });

        // Step 2: Build ancestor data with caching
        const ancestorCache: Record<string, string[]> = {};

        const buildAncestorChain = (taskId: string, parentId: string | undefined): string[] => {
            // Include the task itself in its ancestor chain
            if (!parentId) {
                return [taskId];
            }

            // Check cache first (reuse for siblings with same parent)
            if (ancestorCache[parentId]) {
                return [taskId, ...ancestorCache[parentId]];
            }

            // Walk up the parent chain
            const chain = [taskId];
            let currentParentId: string | undefined = parentId;

            while (currentParentId && tasksById[currentParentId]) {
                chain.push(currentParentId);
                currentParentId = tasksById[currentParentId].v2_parent_id || tasksById[currentParentId].parent_id;
            }

            // Cache the chain for this parent (excluding the task itself)
            ancestorCache[parentId] = chain.slice(1);

            return chain;
        };

        const bulkOps = [];

        for (const task of allTasks) {
            // Build ancestor data
            const taskId = task.v2_id || task.id
            const parentId = task.v2_parent_id || task.parent_id;
            const ancestorIds = buildAncestorChain(taskId, parentId);
            const ancestorSet: Record<string, boolean> = {};
            ancestorIds.forEach((id: string) => {
                ancestorSet[id] = true;
            });

            // Normalize the Todoist task to match our schema
            const normalizedTask = {
                ...task,
                id: taskId,
                title: task.content || task.title || '',
                description: task.description || '',
                projectId: task.v2_project_id || task.project_id,
                parentId: parentId,
                completedTime: task.completed_at ? new Date(task.completed_at) : null,
                ancestorIds,
                ancestorSet,
            };

            // Add upsert operation to bulk array
            bulkOps.push({
                updateOne: {
                    filter: { id: taskId },
                    update: { $set: normalizedTask },
                    upsert: true,
                },
            });
        }

        // Execute all operations in a single bulkWrite
        const result = await TaskTodoist.bulkWrite(bulkOps);

        // Update sync metadata with current time
        syncMetadata.lastSyncTime = new Date();
        await syncMetadata.save();

        res.status(200).json({
            message: 'Todoist tasks synced successfully',
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
            matchedCount: result.matchedCount,
            totalOperations: bulkOps.length,
            lastSyncTime: syncMetadata.lastSyncTime,
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Todoist tasks.',
        });
    }
});

router.post('/ticktick/projects', verifyToken, async (req: CustomRequest, res) => {
    try {
        const result = await syncTickTickProjects(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing TickTick projects.',
        });
    }
});

router.post('/ticktick/project-groups', verifyToken, async (req: CustomRequest, res) => {
    try {
        const result = await syncTickTickProjectGroups(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing TickTick project groups.',
        });
    }
});

router.post('/todoist/projects', verifyToken, async (req: CustomRequest, res) => {
    try {
        const result = await syncTodoistProjects(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Todoist projects.',
        });
    }
});

router.post('/session/projects', verifyToken, async (req: CustomRequest, res) => {
    try {
        // Fetch raw Session focus records (includes full category data)
        const rawSessionRecords = await fetchSessionFocusRecordsWithNoBreaks();

        // Extract unique categories/projects
        const categoriesMap = new Map();

        for (const record of rawSessionRecords) {
            const category = record['category'];

            if (category) {
                const categoryId = category['id'] || 'general-session';
                const categoryTitle = category['title'] || 'General';
                const hexColor = category['hex_color'] || '';

                // Skip if already processed
                if (!categoriesMap.has(categoryId)) {
                    categoriesMap.set(categoryId, {
                        id: categoryId === '' ? 'general-session' : categoryId,
                        name: categoryTitle,
                        color: hexColor,
                    });
                }
            }
        }

        // Convert map to array and prepare bulk operations
        const uniqueCategories = Array.from(categoriesMap.values());
        const bulkOps = [];

        for (const category of uniqueCategories) {
            const normalizedProject = {
                id: category.id,
                source: 'ProjectSession',
                name: category.name,
                color: category.color,
            };

            bulkOps.push({
                updateOne: {
                    filter: { id: category.id },
                    update: { $set: normalizedProject },
                    upsert: true,
                },
            });
        }

        // Execute bulk operations if there are any
        const result = bulkOps.length > 0
            ? await ProjectSession.bulkWrite(bulkOps)
            : { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 };

        res.status(200).json({
            message: 'Session projects synced successfully',
            recordsProcessed: uniqueCategories.length,
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
            matchedCount: result.matchedCount,
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Session projects.',
        });
    }
});

router.post('/ticktick/all', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';

        // Run all sync operations in parallel
        const [tasksResult, projectsResult, projectGroupsResult, focusRecordsResult] = await Promise.all([
            syncTickTickTasks(userId),
            syncTickTickProjects(userId),
            syncTickTickProjectGroups(userId),
            syncTickTickFocusRecords(userId, timezone)
        ]);

        res.status(200).json({
            message: 'All data synced successfully',
            tasks: tasksResult,
            projects: projectsResult,
            projectGroups: projectGroupsResult,
            focusRecords: focusRecordsResult
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing all data.',
        });
    }
});

router.post('/ticktick/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';
        const result = await syncTickTickFocusRecords(req.user!.userId, timezone);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing TickTick focus records.',
        });
    }
});

router.post('/be-focused/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';

        // Fetch raw BeFocused data
        const rawBeFocusedRecords = await fetchBeFocusedAppFocusRecords();

        // Normalize each record to match TickTick format
        const normalizedRecords = rawBeFocusedRecords.map((record: any) => {
            const startDate = new Date(record['Start date']);
            const durationInMinutes = Number(record['Duration']);
            const durationInSeconds = durationInMinutes * 60; // Convert minutes to seconds
            const endDate = new Date(startDate.getTime() + durationInMinutes * 60 * 1000);
            const assignedTask = record['Assigned task'] || 'Untitled';

            // Create custom taskId: "TaskName - BeFocused"
            const taskId = `${assignedTask} - BeFocused`;

            // Check if record crosses midnight in user's timezone
            const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

            return {
                id: randomUUID(),
                source: 'FocusRecordBeFocused',
                startTime: startDate, // Date object for MongoDB
                endTime: endDate, // Date object for MongoDB
                duration: durationInSeconds, // Duration in seconds like TickTick
                crossesMidnight,
                tasks: [
                    {
                        taskId,
                        title: assignedTask,
                        startTime: startDate, // Date object for MongoDB
                        endTime: endDate, // Date object for MongoDB
                        duration: durationInSeconds, // Each task has the full duration since there's only one task
                    }
                ]
            };
        });

        // Bulk upsert to database
        const bulkOps = normalizedRecords.map((record: any) => ({
            updateOne: {
                filter: { id: record.id },
                update: { $set: record },
                upsert: true
            }
        }));

        const result = await FocusRecordBeFocused.bulkWrite(bulkOps);

        res.status(200).json({
            message: 'BeFocused focus records synced successfully',
            recordsProcessed: normalizedRecords.length,
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing BeFocused focus records.',
        });
    }
});

router.post('/forest/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';

        // Fetch raw Forest data
        const rawForestRecords = await fetchForestAppFocusRecords(true);

        // Normalize each record to match TickTick format
        const normalizedRecords = rawForestRecords.map((record: any) => {
            const startDate = new Date(record['Start Time']);
            const endDate = new Date(record['End Time']);
            const durationInSeconds = Math.floor((endDate.getTime() - startDate.getTime()) / 1000);
            const tag = record['Tag'] || '';
            const note = record['Note'] || '';
            const treeType = record['Tree Type'] || '';
            const isSuccess = record['Is Success'] === 'True';

            // Create custom taskId: "Tag - Forest"
            const taskId = `${tag} - Forest`;

            // Check if record crosses midnight in user's timezone
            const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

            return {
                id: randomUUID(),
                source: 'FocusRecordForest',
                startTime: startDate, // Date object for MongoDB
                endTime: endDate, // Date object for MongoDB
                duration: durationInSeconds, // Duration in seconds like TickTick
                crossesMidnight,
                note,
                treeType,
                isSuccess,
                tasks: [
                    {
                        taskId,
                        title: tag,
                        startTime: startDate, // Date object for MongoDB
                        endTime: endDate, // Date object for MongoDB
                        duration: durationInSeconds, // Each task has the full duration since there's only one task
                    }
                ]
            };
        });

        // Bulk upsert to database
        const bulkOps = normalizedRecords.map((record: any) => ({
            updateOne: {
                filter: { id: record.id },
                update: { $set: record },
                upsert: true
            }
        }));

        const result = await FocusRecordForest.bulkWrite(bulkOps);

        res.status(200).json({
            message: 'Forest focus records synced successfully',
            recordsProcessed: normalizedRecords.length,
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Forest focus records.',
        });
    }
});

router.post('/tide/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';

        // Fetch raw Tide data
        const rawTideRecords = await fetchTideAppFocusRecords();

        // Helper function to parse duration string (e.g., "1h50m", "35m", "3m")
        const parseDuration = (durationStr: string): number => {
            let totalSeconds = 0;
            const hourMatch = durationStr.match(/(\d+)h/);
            const minuteMatch = durationStr.match(/(\d+)m/);

            if (hourMatch) {
                totalSeconds += parseInt(hourMatch[1]) * 3600;
            }
            if (minuteMatch) {
                totalSeconds += parseInt(minuteMatch[1]) * 60;
            }

            return totalSeconds;
        };

        // Normalize each record to match TickTick format
        const normalizedRecords = rawTideRecords.map((record: any) => {
            const startDate = new Date(record['startTime']);
            const durationInSeconds = parseDuration(record['duration']);
            const endDate = new Date(startDate.getTime() + durationInSeconds * 1000);
            const name = record['name'] || 'Untitled';

            // Create custom taskId: "Name - Tide"
            const taskId = `${name} - Tide`;

            // Check if record crosses midnight in user's timezone
            const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

            return {
                id: `${startDate.getTime()}-tide`, // Custom ID based on start time
                source: 'FocusRecordTide',
                startTime: startDate, // Date object for MongoDB
                endTime: endDate, // Date object for MongoDB
                duration: durationInSeconds, // Duration in seconds like TickTick
                crossesMidnight,
                tasks: [
                    {
                        taskId,
                        title: name,
                        startTime: startDate, // Date object for MongoDB
                        endTime: endDate, // Date object for MongoDB
                        duration: durationInSeconds, // Each task has the full duration since there's only one task
                    }
                ]
            };
        });

        // Bulk upsert to database
        const bulkOps = normalizedRecords.map((record: any) => ({
            updateOne: {
                filter: { id: record.id },
                update: { $set: record },
                upsert: true
            }
        }));

        const result = await FocusRecordTide.bulkWrite(bulkOps);

        res.status(200).json({
            message: 'Tide focus records synced successfully',
            recordsProcessed: normalizedRecords.length,
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Tide focus records.',
        });
    }
});

router.post('/session/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';

        // Fetch raw Session data
        const rawSessionRecords = await fetchSessionFocusRecordsWithNoBreaks();

        // Normalize each record to match TickTick format
        const normalizedRecords = rawSessionRecords.map((record: any) => {
            const startDate = new Date(record['start_date']);
            const endDate = new Date(record['end_date']);
            const totalDurationInSeconds = record['duration_second'];
            const pauseDurationInSeconds = record['pause_second'] || 0;
            const actualDurationInSeconds = totalDurationInSeconds - pauseDurationInSeconds;

            const categoryTitle = record['category']?.['title'] || 'General';
            const categoryId = record['category']?.['id'] || 'general-session';
            const title = record['title'] || categoryTitle;
            const note = record['notes'] || '';

            // Normalize "General" category
            const projectId = categoryId === '' ? 'general-session' : categoryId;
            const projectName = categoryTitle;

            // Parse meta array to get pause periods
            const metaPauses = (record['meta'] || [])
                .filter((m: any) => m.type === 'PAUSE')
                .map((m: any) => ({
                    start: new Date(m['start_date']),
                    end: new Date(m['end_date'])
                }))
                .sort((a: any, b: any) => a.start.getTime() - b.start.getTime());

            // Build tasks array by splitting based on pauses
            const tasks = [];
            let currentStart = startDate;

            for (const pause of metaPauses) {
                // Task before this pause
                const taskEnd = pause.start;
                const taskDuration = Math.floor((taskEnd.getTime() - currentStart.getTime()) / 1000);

                if (taskDuration > 0) {
                    tasks.push({
                        taskId: `${title} - Session`,
                        title,
                        startTime: currentStart,
                        endTime: taskEnd,
                        duration: taskDuration,
                        projectId,
                        projectName,
                    });
                }

                // Move start to after pause
                currentStart = pause.end;
            }

            // Final task (after last pause or entire session if no pauses)
            const finalTaskDuration = Math.floor((endDate.getTime() - currentStart.getTime()) / 1000);
            if (finalTaskDuration > 0) {
                tasks.push({
                    taskId: `${title} - Session`,
                    title,
                    startTime: currentStart,
                    endTime: endDate,
                    duration: finalTaskDuration,
                    projectId,
                    projectName,
                });
            }

            // Check if record crosses midnight in user's timezone
            const crossesMidnight = crossesMidnightInTimezone(startDate, endDate, timezone);

            return {
                id: randomUUID(),
                source: 'FocusRecordSession',
                startTime: startDate,
                endTime: endDate,
                duration: actualDurationInSeconds, // Total duration minus pauses
                crossesMidnight,
                note,
                pauseDuration: pauseDurationInSeconds,
                tasks
            };
        });

        // Bulk upsert to database
        const bulkOps = normalizedRecords.map((record: any) => ({
            updateOne: {
                filter: { id: record.id },
                update: { $set: record },
                upsert: true
            }
        }));

        const result = await FocusRecordSession.bulkWrite(bulkOps);

        res.status(200).json({
            message: 'Session focus records synced successfully',
            recordsProcessed: normalizedRecords.length,
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Session focus records.',
        });
    }
});

export default router;