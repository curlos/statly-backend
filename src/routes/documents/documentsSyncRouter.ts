import express from 'express';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { verifyToken } from '../../middleware/verifyToken';
import SyncMetadata from '../../models/SyncMetadataModel';
import { TaskTodoist } from '../../models/TaskModel';
import { getAllTodoistTasks } from '../../utils/task.utils';
import { syncTickTickTasks, syncTickTickProjects, syncTickTickProjectGroups, syncTickTickFocusRecords, syncTodoistProjects } from '../../utils/sync.utils';

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

router.post('/ticktick/all', verifyToken, async (req: CustomRequest, res) => {
    try {
        const userId = req.user!.userId;

        // Run all sync operations in parallel
        const [tasksResult, projectsResult, projectGroupsResult, focusRecordsResult] = await Promise.all([
            syncTickTickTasks(userId),
            syncTickTickProjects(userId),
            syncTickTickProjectGroups(userId),
            syncTickTickFocusRecords(userId)
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
        const result = await syncTickTickFocusRecords(req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing TickTick focus records.',
        });
    }
});

export default router;