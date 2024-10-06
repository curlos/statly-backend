// src/routes/taskRouter.ts
import express from 'express';
import Tag from '../models/TagModel';
import Task from '../models/taskModel';
const router = express.Router();

router.get('/', async (req, res) => {
	try {
		const tags = await Tag.find(); // Fetch projects based on the filter
		res.status(200).json(tags);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the tags.',
		});
	}
});

router.post('/add', async (req, res) => {
	try {
		const { parentId, ...restOfBody } = req.body;

		const newTag = new Tag(restOfBody);
		const savedTag = await newTag.save();

		if (parentId) {
			const updatedParentTag = await Tag.findByIdAndUpdate(
				parentId,
				{
					$push: { children: savedTag },
				},
				{ new: true, runValidators: true }
			);

			if (!updatedParentTag) {
				console.log('No document found with the specified ID.');
			} else {
				console.log('Document updated successfully:', updatedParentTag);
			}
		}

		return res.status(201).json(savedTag);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during tag creation' });
	}
});

router.put('/edit/:tagId', async (req, res) => {
	const { tagId } = req.params;
	const { oldParentTagId, newParentTagId, ...restOfBody } = req.body;

	try {
		const updatedTag = await Tag.findByIdAndUpdate(tagId, restOfBody, { new: true, runValidators: true });

		if (!updatedTag) {
			return res.status(404).json({ message: 'Tag not found' });
		}

		const parentHasChanged = oldParentTagId !== newParentTagId;

		if (parentHasChanged) {
			if (oldParentTagId) {
				await Tag.findByIdAndUpdate(
					oldParentTagId,
					{
						$pull: { children: updatedTag._id },
					},
					{ new: true, runValidators: true }
				);
			}

			if (newParentTagId) {
				await Tag.findByIdAndUpdate(
					newParentTagId,
					{
						$push: { children: updatedTag._id },
					},
					{ new: true, runValidators: true }
				);
			}
		}

		return res.status(200).json(updatedTag);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during tag update' });
	}
});

router.delete('/delete/:tagId', async (req, res) => {
	const { tagId } = req.params;

	try {
		const deletedTag = await Tag.findByIdAndDelete(tagId);
		if (!deletedTag) {
			return res.status(400).json({ message: 'Tag does not exist.' });
		}

		// Remove the tag ID from all tasks
		await Task.updateMany({ tagIds: tagId }, { $pull: { tagIds: tagId } });

		return res
			.status(200)
			.json({ success: true, message: `Tag deleted successfully and all tasks had the tag removed.` });
	} catch (error) {
		return res
			.status(500)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during tag deletion' });
	}
});

export default router;
