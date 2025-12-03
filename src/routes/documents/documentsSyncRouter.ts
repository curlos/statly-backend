import express from 'express';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { verifyToken } from '../../middleware/verifyToken';
import SyncMetadata from '../../models/SyncMetadataModel';
import ApiCallStatus from '../../models/ApiCallStatusModel';
import { ProjectTickTick } from '../../models/projectModel';
import { syncTickTickFocusRecords, syncBeFocusedFocusRecords, syncForestFocusRecords, syncTideFocusRecords, syncSessionFocusRecords } from '../../utils/sync/syncFocusRecords.utils';
import { syncTickTickProjects, syncTickTickProjectGroups, syncTodoistProjects, syncSessionProjects } from '../../utils/sync/syncProjects.utils';
import { syncTickTickTasks, syncTodoistTasks } from '../../utils/sync/syncTasks.utils';
import { withSyncLock } from '../../utils/withSyncLock';

const router = express.Router();

router.get('/metadata', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;
        const syncMetadata = await SyncMetadata.find({ userId })

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
    } catch (error: any) {
        const statusCode = error?.statusCode || 500;
        res.status(statusCode).json({
            message: error instanceof Error ? error.message : 'An error occurred fetching sync metadata.',
        });
    }
});

router.post('/ticktick/tasks', verifyToken, withSyncLock({
    endpoint: '/documents/sync/ticktick/tasks',
    syncFunction: syncTickTickTasks,
    extractParams: async (req) => {
        const userId = req.user!.userId;

        // Check if first sync
        const lastSync = await SyncMetadata.findOne({
            userId,
            syncType: 'tickTickTasks'
        });

        const isFirstSync = !lastSync;
        let archivedProjectIds;

        // If first sync, get all archived projects
        if (isFirstSync) {
            // Ensure projects are synced first
            await syncTickTickProjects(userId);

            const archivedProjects = await ProjectTickTick.find({
                userId,
                closed: true
            }).lean();
            archivedProjectIds = archivedProjects.map((p: any) => p.id);
        }

        // Return options object for syncTickTickTasks
        return [{ archivedProjectIds }];
    },
    errorMessage: 'An error occurred transferring tasks.'
}));

router.post('/ticktick/tasks-from-archived-projects', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;
        const { archivedProjectIds } = req.body; // Required: array of project IDs

        if (!archivedProjectIds || !Array.isArray(archivedProjectIds) || archivedProjectIds.length === 0) {
            return res.status(400).json({
                message: 'archivedProjectIds array is required'
            });
        }

        // Sync ONLY archived project tasks (skip regular tasks)
        const result = await syncTickTickTasks(userId, {
            archivedProjectIds: archivedProjectIds,
            getTasksFromNonArchivedProjects: false  // Don't fetch regular tasks
        });

        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'Error syncing archived project tasks'
        });
    }
});

router.post('/todoist/tasks', verifyToken, async (req: CustomRequest, res) => {
    try {
        const result = await syncTodoistTasks(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Todoist tasks.',
        });
    }
});

router.post('/ticktick/projects', verifyToken, withSyncLock({
    endpoint: '/documents/sync/ticktick/projects',
    syncFunction: syncTickTickProjects,
    errorMessage: 'An error occurred syncing TickTick projects.'
}));

router.post('/ticktick/project-groups', verifyToken, withSyncLock({
    endpoint: '/documents/sync/ticktick/project-groups',
    syncFunction: syncTickTickProjectGroups,
    errorMessage: 'An error occurred syncing TickTick project groups.'
}));

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
        const result = await syncSessionProjects(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Session projects.',
        });
    }
});

router.post('/ticktick/all', verifyToken, async (req: CustomRequest, res) => {
    const userId = req.user!.userId;
    const apiEndpoint = '/documents/sync/ticktick/all';

    try {
        // Check for existing sync in progress
        let apiCallStatus = await ApiCallStatus.findOne({ userId, apiEndpoint });

        if (!apiCallStatus) {
            // Create new status document
            apiCallStatus = new ApiCallStatus({
                userId,
                apiEndpoint,
                isInProgress: false,
                startedAt: new Date(),
            });
        }

        // Check if sync is already in progress
        if (apiCallStatus.isInProgress) {
            // Check if lock is stale (older than 10 minutes)
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            if (apiCallStatus.startedAt > tenMinutesAgo) {
                // Lock is active and recent, return 409
                return res.status(409).json({
                    message: 'Sync already in progress',
                    startedAt: apiCallStatus.startedAt,
                });
            }
            // Lock is stale (>10 minutes old), proceed with sync
        }

        // Acquire lock
        apiCallStatus.isInProgress = true;
        apiCallStatus.startedAt = new Date();
        await apiCallStatus.save();

        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';

        // Check if first sync for tasks
        const lastTasksSync = await SyncMetadata.findOne({
            userId,
            syncType: 'tickTickTasks'
        });

        const isFirstTasksSync = !lastTasksSync;

        const syncPromises = [
            syncTickTickProjectGroups(userId),
            syncTickTickFocusRecords(userId, timezone)
        ];

        let projectsResult;
        let archivedProjectIds;

        if (isFirstTasksSync) {
            projectsResult = await syncTickTickProjects(userId);

            const archivedProjects = await ProjectTickTick.find({
                userId,
                closed: true
            }).lean();
            archivedProjectIds = archivedProjects.map((p: any) => p.id);
        } else {
            syncPromises.push(syncTickTickProjects(userId));
        }

        const tasksResult = await syncTickTickTasks(userId, { archivedProjectIds });
        const results = await Promise.all(syncPromises);

        // Map results
        const [projectGroupsResult, focusRecordsResult] = results;
        if (!isFirstTasksSync) {
            projectsResult = results[2]; // Projects was 3rd in parallel array
        }

        // Release lock
        apiCallStatus.isInProgress = false;
        await apiCallStatus.save();

        res.status(200).json({
            message: 'All data synced successfully',
            tasks: tasksResult,
            projects: projectsResult,
            projectGroups: projectGroupsResult,
            focusRecords: focusRecordsResult
        });
    } catch (error) {
        // Release lock on error
        try {
            const apiCallStatus = await ApiCallStatus.findOne({ userId, apiEndpoint });
            if (apiCallStatus) {
                apiCallStatus.isInProgress = false;
                await apiCallStatus.save();
            }
        } catch (lockError) {
            console.error('Failed to release lock:', lockError);
        }

        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing all data.',
        });
    }
});

router.post('/ticktick/focus-records', verifyToken, withSyncLock({
    endpoint: '/documents/sync/ticktick/focus-records',
    syncFunction: syncTickTickFocusRecords,
    extractParams: (req) => {
        const timezone = req.body.timezone || 'UTC';
        return [timezone];
    },
    errorMessage: 'An error occurred syncing TickTick focus records.'
}));

router.post('/be-focused/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';
        const result = await syncBeFocusedFocusRecords(userId, timezone);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing BeFocused focus records.',
        });
    }
});

router.post('/forest/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';
        const result = await syncForestFocusRecords(userId, timezone);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Forest focus records.',
        });
    }
});

router.post('/tide/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';
        const result = await syncTideFocusRecords(userId, timezone);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Tide focus records.',
        });
    }
});

router.post('/session/focus-records', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;
        // Get timezone from request body (defaults to UTC)
        const timezone = req.body.timezone || 'UTC';
        const result = await syncSessionFocusRecords(userId, timezone);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Session focus records.',
        });
    }
});

router.post('/old-focus-apps/focus-records-tasks-and-projects', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;
        // Get timezone from request body (required)
        const timezone = req.body.timezone;

        if (!timezone) {
            return res.status(400).json({
                message: 'timezone is required'
            });
        }

        // Run all old focus app sync operations in parallel, including Todoist tasks/projects and Session projects
        const [
            beFocusedResult,
            forestResult,
            tideResult,
            sessionResult,
            todoistTasksResult,
            todoistProjectsResult,
            sessionProjectsResult
        ] = await Promise.all([
            syncBeFocusedFocusRecords(userId, timezone),
            syncForestFocusRecords(userId, timezone),
            syncTideFocusRecords(userId, timezone),
            syncSessionFocusRecords(userId, timezone),
            syncTodoistTasks(userId),
            syncTodoistProjects(userId),
            syncSessionProjects(userId)
        ]);

        res.status(200).json({
            message: 'All old focus apps synced successfully',
            beFocused: beFocusedResult,
            forest: forestResult,
            tide: tideResult,
            session: sessionResult,
            todoistTasks: todoistTasksResult,
            todoistProjects: todoistProjectsResult,
            sessionProjects: sessionProjectsResult
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing old focus apps.',
        });
    }
});

export default router;