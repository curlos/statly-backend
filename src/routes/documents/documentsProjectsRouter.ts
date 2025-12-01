import express from 'express';
import { CustomRequest } from '../../interfaces/CustomRequest';
import { Project } from '../../models/projectModel';
import { ProjectGroupTickTick } from '../../models/projectGroupModel';
import { verifyToken } from '../../middleware/verifyToken';

const router = express.Router();

// GET /projects - Returns all projects with only necessary fields
router.get('/', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user!.userId;
		// Only select fields actually used by frontend (reduces payload by ~90%)
		const projects = await Project.find({ userId })
			.select('id name color closed groupId source')
			.lean();
		res.status(200).json(projects);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching projects.',
		});
	}
});

// GET /project-groups - Returns all project groups with only necessary fields
router.get('/project-groups', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user!.userId;
		// Only select fields actually used by frontend (id and name)
		const projectGroups = await ProjectGroupTickTick.find({ userId })
			.select('id name')
			.lean();
		res.status(200).json(projectGroups);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching project groups.',
		});
	}
});

export default router;
