import express from 'express';
import Project from '../models/projectModel';
import Task from '../models/TaskModel';

const router = express.Router();

router.get('/', async (req, res) => {
	try {
		const isFolderQuery = req.query.isFolder;

		let filter = {};

		if (isFolderQuery === 'true') {
			filter = { isFolder: true };
		}

		const projects = await Project.find(filter);
		res.status(200).json(projects);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the projects',
		});
	}
});

router.post('/add', async (req, res) => {
	try {
		if (req.body.isInbox) {
			const existingInbox = await Project.findOne({ isInbox: true });
			if (existingInbox) {
				return res.status(400).json({ message: 'An Inbox project already exists' });
			}
		}

		const newProject = new Project(req.body);
		const savedProject = await newProject.save();
		return res.status(201).json(savedProject);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during project creation' });
	}
});

router.put('/edit/:projectId', async (req, res) => {
	const { projectId } = req.params;
	const updateData = req.body;

	try {
		const currentProject = await Project.findById(projectId);
		if (!currentProject) {
			return res.status(404).json({ message: 'Project not found' });
		}

		if ('isInbox' in updateData && currentProject.isInbox !== updateData.isInbox) {
			return res.status(400).json({ message: 'Cannot change the isInbox property of a project.' });
		}

		const updatedProject = await Project.findByIdAndUpdate(projectId, updateData, {
			new: true,
			runValidators: true,
			omitUndefined: true,
		});
		if (!updatedProject) {
			return res.status(404).json({ message: 'Project not found' });
		}

		return res.status(200).json(updatedProject);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during project update' });
	}
});

router.delete('/delete/:projectId', async (req, res) => {
	const { projectId } = req.params;

	try {
		const projectToDelete = await Project.findById(projectId);
		if (!projectToDelete) {
			return res.status(404).json({ message: 'Project not found.' });
		}

		if (projectToDelete.isInbox) {
			return res.status(400).json({ message: 'Cannot delete the Inbox project.' });
		}

		const inboxProject = await Project.findOne({ isInbox: true });
		if (!inboxProject) {
			return res.status(404).json({ message: 'Inbox project not found. Cannot reassign tasks.' });
		}

		const projectDelete = await Project.findByIdAndDelete(projectId);
		if (!projectDelete) {
			return res.status(400).json({ message: 'Failed to delete the project.' });
		}

		const tasksUpdate = await Task.updateMany({ projectId: projectId }, { $set: { projectId: inboxProject._id } });

		if (tasksUpdate.matchedCount === 0) {
			console.log('No tasks to update.');
		} else if (tasksUpdate.modifiedCount !== tasksUpdate.matchedCount) {
			console.log('Not all tasks were updated.');
		}

		return res
			.status(200)
			.json({ message: `Project deleted successfully and all tasks were reassigned to the Inbox project.` });
	} catch (error) {
		return res
			.status(500)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during project deletion' });
	}
});

export default router;
