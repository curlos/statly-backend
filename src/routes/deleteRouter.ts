import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import { CustomRequest } from '../interfaces/CustomRequest';
import FocusRecord from '../models/FocusRecord';
import Task from '../models/TaskModel';
import Project from '../models/ProjectModel';
import ProjectGroupTickTick from '../models/ProjectGroupModel';
import SyncMetadata from '../models/SyncMetadataModel';
const router = express.Router();

// Delete single focus record by ID for logged in user
router.delete('/focus-record/:id', verifyToken, async (req: CustomRequest, res) => {
	const userId = req.user!.userId;
	const { id } = req.params;

	try {
		// Delete focus record only if it belongs to this user
		const result = await FocusRecord.deleteOne({ id, userId });

		if (result.deletedCount === 0) {
			return res.status(404).json({ message: 'Focus record not found' });
		}

		res.json({
			deletedCount: result.deletedCount,
			message: 'Focus record deleted successfully'
		});
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

// Delete multiple tasks by IDs for logged in user (bulk delete)
router.post('/tasks/bulk-delete', verifyToken, async (req: CustomRequest, res) => {
	const userId = req.user!.userId
	const { taskIds } = req.body;

	if (!Array.isArray(taskIds) || taskIds.length === 0) {
		return res.status(400).json({ message: 'taskIds must be a non-empty array' });
	}

	try {
		// Delete all tasks that belong to this user and match the provided IDs
		const result = await Task.deleteMany({
			id: { $in: taskIds },
			userId
		});

		res.json({
			deletedCount: result.deletedCount,
			message: `${result.deletedCount} task(s) deleted successfully`
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : error
		});
	}
});

// Delete focus records for logged in user
router.delete('/focus-records', verifyToken, async (req: CustomRequest, res) => {
	const userId = req.user!.userId;

	try {
		// Delete all focus records AND their sync metadata
		const [focusRecordsResult, syncMetadataResult] = await Promise.all([
			FocusRecord.deleteMany({ userId }),
			SyncMetadata.deleteMany({
				userId,
				syncType: {
					$in: ['tickTickFocusRecords', 'beFocusedFocusRecords', 'forestFocusRecords', 'tideFocusRecords', 'sessionFocusRecords']
				}
			})
		]);
		res.json({
			deletedCount: focusRecordsResult.deletedCount,
			syncMetadataDeleted: syncMetadataResult.deletedCount,
			message: 'Focus records deleted successfully'
		});
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

// Delete tasks for logged in user
router.delete('/tasks', verifyToken, async (req: CustomRequest, res) => {
	const userId = req.user!.userId;

	try {
		// Delete all tasks AND their sync metadata
		const [tasksResult, syncMetadataResult] = await Promise.all([
			Task.deleteMany({ userId }),
			SyncMetadata.deleteMany({
				userId,
				syncType: {
					$in: ['tickTickTasks', 'todoistTasks']
				}
			})
		]);
		res.json({
			deletedCount: tasksResult.deletedCount,
			syncMetadataDeleted: syncMetadataResult.deletedCount,
			message: 'Tasks deleted successfully'
		});
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

// Delete projects for logged in user
router.delete('/projects', verifyToken, async (req: CustomRequest, res) => {
	const userId = req.user!.userId;

	try {
		// Delete all projects AND their sync metadata
		const [projectsResult, syncMetadataResult] = await Promise.all([
			Project.deleteMany({ userId }),
			SyncMetadata.deleteMany({
				userId,
				syncType: {
					$in: ['tickTickProjects', 'todoistProjects', 'sessionProjects']
				}
			})
		]);
		res.json({
			deletedCount: projectsResult.deletedCount,
			syncMetadataDeleted: syncMetadataResult.deletedCount,
			message: 'Projects deleted successfully'
		});
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

// Delete project groups for logged in user
router.delete('/project-groups', verifyToken, async (req: CustomRequest, res) => {
	const userId = req.user!.userId;

	try {
		// Delete all project groups AND their sync metadata
		const [projectGroupsResult, syncMetadataResult] = await Promise.all([
			ProjectGroupTickTick.deleteMany({ userId }),
			SyncMetadata.deleteMany({
				userId,
				syncType: 'tickTickProjectGroups'
			})
		]);
		res.json({
			deletedCount: projectGroupsResult.deletedCount,
			syncMetadataDeleted: syncMetadataResult.deletedCount,
			message: 'Project groups deleted successfully'
		});
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

// Delete all documents for logged in user
router.delete('/all', verifyToken, async (req: CustomRequest, res) => {
	const userId = req.user!.userId;

	try {
		// Delete all documents AND all sync metadata for this user
		const [focusRecordsResult, tasksResult, projectsResult, projectGroupsResult, syncMetadataResult] = await Promise.all([
			FocusRecord.deleteMany({ userId }),
			Task.deleteMany({ userId }),
			Project.deleteMany({ userId }),
			ProjectGroupTickTick.deleteMany({ userId }),
			SyncMetadata.deleteMany({ userId }) // Delete ALL sync metadata for this user
		]);

		res.json({
			deletedCounts: {
				focusRecords: focusRecordsResult.deletedCount,
				tasks: tasksResult.deletedCount,
				projects: projectsResult.deletedCount,
				projectGroups: projectGroupsResult.deletedCount,
				syncMetadata: syncMetadataResult.deletedCount
			},
			message: 'All documents deleted successfully'
		});
	} catch (error) {
		res.status(500).json({ message: error instanceof Error ? error.message : error });
	}
});

export default router;
