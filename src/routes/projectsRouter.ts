import express from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import { verifyToken } from '../middleware/verifyToken';
import ProjectGroupTickTick from '../models/projectGroupModel';
import Project from '../models/projectModel';

const router = express.Router();

// GET /projects - Returns all projects with conditional field selection
router.get('/', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user!.userId;
		const fullData = req.query.fullData === 'true';

		const query = Project.find({ userId });

		// Only select limited fields if fullData is not requested
		if (!fullData) {
			query.select('id name color closed groupId source');
		}

		const projects = await query.lean();
		res.status(200).json(projects);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching projects.',
		});
	}
});

// GET /project-groups - Returns all project groups with conditional field selection
router.get('/project-groups', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user!.userId;
		const fullData = req.query.fullData === 'true';

		const query = ProjectGroupTickTick.find({ userId });

		// Only select limited fields if fullData is not requested
		if (!fullData) {
			query.select('id name source');
		}

		const projectGroups = await query.lean();
		res.status(200).json(projectGroups);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching project groups.',
		});
	}
});

export default router;
