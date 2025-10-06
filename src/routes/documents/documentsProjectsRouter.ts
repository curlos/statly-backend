import express from 'express';
import { Project } from '../../models/projectModel';
import { ProjectGroupTickTick } from '../../models/projectGroupModel';
import { verifyToken } from '../../middleware/verifyToken';

const router = express.Router();

// GET /projects - Returns all projects
router.get('/', verifyToken, async (_req, res) => {
	try {
		const projects = await Project.find({});
		res.status(200).json(projects);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching projects.',
		});
	}
});

// GET /project-groups - Returns all project groups
router.get('/project-groups', verifyToken, async (_req, res) => {
	try {
		const projectGroups = await ProjectGroupTickTick.find({});
		res.status(200).json(projectGroups);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching project groups.',
		});
	}
});

export default router;
