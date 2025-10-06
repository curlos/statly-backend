import express from 'express';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { verifyToken } from '../../middleware/verifyToken';
import SyncMetadata from '../../models/SyncMetadataModel';
import { TaskTickTick, TaskTodoist } from '../../models/TaskModel';
import { getAllTodoistTasks } from '../../utils/task.utils';
import { fetchAllTickTickTasks } from '../../utils/ticktick.utils';

const router = express.Router();

router.get('/metadata', verifyToken, async (req, res) => {
    try {
        const syncMetadata = await SyncMetadata.findOne({ syncType: 'tasks' });

        if (!syncMetadata) {
            return res.status(404).json({
                message: 'No sync metadata found',
            });
        }

        res.status(200).json(syncMetadata);
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred fetching sync metadata.',
        });
    }
});

router.post('/ticktick-tasks', verifyToken, async (req: CustomRequest, res) => {
    try {
        // Get or create sync metadata
        let syncMetadata = await SyncMetadata.findOne({ syncType: 'tasks' });

        if (!syncMetadata) {
            syncMetadata = new SyncMetadata({
                userId: req.user!.userId,
                syncType: 'tasks',
                lastSyncTime: new Date(0), // Set to epoch so all tasks are synced initially
            });
        }

        const lastSyncTime = syncMetadata.lastSyncTime;
        const tickTickTasks = await fetchAllTickTickTasks();

        // Step 1: Build tasksById map for quick parent lookups
        const tasksById: Record<string, any> = {};
        tickTickTasks.forEach((task: any) => {
            tasksById[task.id] = task;
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
                currentParentId = tasksById[currentParentId].parentId;
            }

            // Cache the chain for this parent (excluding the task itself)
            ancestorCache[parentId] = chain.slice(1);

            return chain;
        };

        const bulkOps = [];

        for (const task of tickTickTasks) {
            // Check if task needs updating based on modifiedTime
            const taskModifiedTime = task.modifiedTime ? new Date(task.modifiedTime) : null;
            const shouldUpdateTask = !taskModifiedTime || taskModifiedTime >= lastSyncTime;

            if (shouldUpdateTask) {
                // Build ancestor data for full task
                const ancestorIds = buildAncestorChain(task.id, task.parentId);
                const ancestorSet: Record<string, boolean> = {};
                ancestorIds.forEach((id: string) => {
                    ancestorSet[id] = true;
                });

                // Normalize the FULL task
                const normalizedFullTask = {
                    ...task,
                    taskSource: 'ticktick',
                    taskType: 'full',
                    title: task.title,
                    description: task.desc || task.description || '',
                    projectId: task.projectId,
                    parentId: task.parentId,
                    completedTime: task.completedTime,
                    sortOrder: task.sortOrder,
                    timeZone: task.timeZone,
                    ancestorIds,
                    ancestorSet,
                };

                // Add full task upsert operation to bulk array
                bulkOps.push({
                    updateOne: {
                        filter: { id: task.id },
                        update: { $set: normalizedFullTask },
                        upsert: true,
                    },
                });

                // Process items array (if it exists and has items)
                // Items are always updated if their parent task is updated
                if (task.items && task.items.length > 0) {
                    for (const item of task.items) {
                        // Build ancestor data for item (parent is the full task)
                        const itemAncestorIds = buildAncestorChain(item.id, task.id);
                        const itemAncestorSet: Record<string, boolean> = {};
                        itemAncestorIds.forEach((id: string) => {
                            itemAncestorSet[id] = true;
                        });

                        // Normalize item task
                        const normalizedItemTask = {
                            ...item,
                            taskSource: 'ticktick',
                            taskType: 'item',
                            title: item.title,
                            description: '',
                            projectId: task.projectId, // Inherit from parent
                            parentId: task.id, // Parent is the full task
                            completedTime: item.completedTime,
                            sortOrder: item.sortOrder,
                            timeZone: item.timeZone,
                            startDate: item.startDate,
                            ancestorIds: itemAncestorIds,
                            ancestorSet: itemAncestorSet,
                        };

                        // Add item task upsert operation to bulk array
                        bulkOps.push({
                            updateOne: {
                                filter: { id: item.id },
                                update: { $set: normalizedItemTask },
                                upsert: true,
                            },
                        });
                    }
                }
            }
        }

        // Execute all operations in a single bulkWrite
        const result = await TaskTickTick.bulkWrite(bulkOps);

        // Update sync metadata with current time and tasks updated count
        syncMetadata.lastSyncTime = new Date();
        syncMetadata.tasksUpdated = bulkOps.length;
        await syncMetadata.save();

        res.status(200).json({
            message: 'Transfer complete',
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
            matchedCount: result.matchedCount,
            totalOperations: bulkOps.length,
            lastSyncTime: syncMetadata.lastSyncTime,
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred transferring tasks.',
        });
    }
});

router.post('/todoist-tasks', verifyToken, async (req: CustomRequest, res) => {
    try {
        const allTasks = await getAllTodoistTasks();

        // Step 1: Build tasksById map for quick parent lookups
        const tasksById: Record<string, any> = {};
        allTasks.forEach((task: any) => {
            tasksById[task.id] = task;
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
            const parentId = task.v2_parent_id || task.parent_id;
            const ancestorIds = buildAncestorChain(task.id, parentId);
            const ancestorSet: Record<string, boolean> = {};
            ancestorIds.forEach((id: string) => {
                ancestorSet[id] = true;
            });

            // Normalize the Todoist task to match our schema
            const normalizedTask = {
                ...task,
                id: task.id,
                taskSource: 'todoist',
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
                    filter: { id: task.id },
                    update: { $set: normalizedTask },
                    upsert: true,
                },
            });
        }

        // Execute all operations in a single bulkWrite
        const result = await TaskTodoist.bulkWrite(bulkOps);

        res.status(200).json({
            message: 'Todoist tasks synced successfully',
            upsertedCount: result.upsertedCount,
            modifiedCount: result.modifiedCount,
            matchedCount: result.matchedCount,
            totalOperations: bulkOps.length,
        });
    } catch (error) {
        res.status(500).json({
            message: error instanceof Error ? error.message : 'An error occurred syncing Todoist tasks.',
        });
    }
});

export default router;