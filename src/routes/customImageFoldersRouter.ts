import express from 'express';
import { verifyToken } from '../middleware/verifyToken';
import { CustomRequest } from '../interfaces/CustomRequest';
import CustomImageFolder from '../models/CustomImageFolderModel';
import CustomImage from '../models/CustomImageModel';
import cloudinary from '../config/cloudinary';

const router = express.Router();

// GET /custom-image-folders - Get all folders for current user
router.get('/', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		const folders = await CustomImageFolder.find({ userId }).sort({ sortOrder: 1, createdAt: 1 });

		// Ensure GENERAL folder always exists
		if (!folders.find(f => f.name === 'GENERAL')) {
			const generalFolder = new CustomImageFolder({
				userId,
				name: 'GENERAL',
				sortOrder: 0
			});
			await generalFolder.save();
			folders.unshift(generalFolder);
		}

		res.json(folders);
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to fetch folders',
		});
	}
});

// POST /custom-image-folders - Create new folder
router.post('/', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { name } = req.body;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!name || name.trim() === '') {
			return res.status(400).json({ message: 'Folder name required' });
		}

		const normalizedName = name.toUpperCase().trim();

		// Validate name length
		if (normalizedName.length > 50) {
			return res.status(400).json({ message: 'Folder name too long (max 50 characters)' });
		}

		// Check for duplicate (unique index will also catch this, but explicit check gives better error message)
		const existing = await CustomImageFolder.findOne({ userId, name: normalizedName });
		if (existing) {
			return res.status(400).json({ message: 'Folder already exists' });
		}

		// Get max sortOrder
		const maxSortOrderDoc = await CustomImageFolder.findOne({ userId })
			.sort({ sortOrder: -1 })
			.select('sortOrder');

		const folder = new CustomImageFolder({
			userId,
			name: normalizedName,
			sortOrder: maxSortOrderDoc ? maxSortOrderDoc.sortOrder + 1 : 1 // GENERAL is 0, new folders start at 1
		});

		await folder.save();
		res.status(201).json(folder);
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to create folder',
		});
	}
});

// PUT /custom-image-folders/:id - Rename folder
router.put('/:id', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { id } = req.params;
		const { name } = req.body;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!name || name.trim() === '') {
			return res.status(400).json({ message: 'Folder name required' });
		}

		const folder = await CustomImageFolder.findOne({ _id: id, userId });
		if (!folder) {
			return res.status(404).json({ message: 'Folder not found' });
		}

		// Prevent renaming GENERAL
		if (folder.name === 'GENERAL') {
			return res.status(400).json({ message: 'Cannot rename GENERAL folder' });
		}

		const normalizedName = name.toUpperCase().trim();

		// Validate name length
		if (normalizedName.length > 50) {
			return res.status(400).json({ message: 'Folder name too long (max 50 characters)' });
		}

		// Check for duplicate (don't allow renaming to an existing folder name)
		const existing = await CustomImageFolder.findOne({ userId, name: normalizedName });
		if (existing && existing._id.toString() !== id) {
			return res.status(400).json({ message: 'Folder name already exists' });
		}

		const oldName = folder.name;

		// Update folder name
		folder.name = normalizedName;
		await folder.save();

		// Update all images that reference the old folder name
		await CustomImage.updateMany(
			{ userId, folder: oldName },
			{ $set: { folder: normalizedName } }
		);

		res.json(folder);
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to rename folder',
		});
	}
});

// DELETE /custom-image-folders/:id - Delete folder
// Query params: strategy = 'moveToGeneral' | 'deleteImages' (optional)
router.delete('/:id', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { id } = req.params;
		const { strategy } = req.query; // 'moveToGeneral' or 'deleteImages'

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		const folder = await CustomImageFolder.findOne({ _id: id, userId });
		if (!folder) {
			return res.status(404).json({ message: 'Folder not found' });
		}

		// Prevent deletion of GENERAL
		if (folder.name === 'GENERAL') {
			return res.status(400).json({ message: 'Cannot delete GENERAL folder' });
		}

		const folderName = folder.name;

		// Handle different deletion strategies
		if (strategy === 'moveToGeneral') {
			// Get all images from the folder being deleted (sorted by current sortOrder to maintain relative order)
			const imagesToMove = await CustomImage.find({ userId, folder: folderName }).sort({ sortOrder: 1 });

			if (imagesToMove.length > 0) {
				// Get the max sortOrder in GENERAL folder
				const maxSortOrderDoc = await CustomImage.findOne({ userId, folder: 'GENERAL' })
					.sort({ sortOrder: -1 })
					.select('sortOrder');
				const startingSortOrder = maxSortOrderDoc ? maxSortOrderDoc.sortOrder + 1 : 0;

				// Update each image with new folder and sequential sortOrder
				const updatePromises = imagesToMove.map((image, index) => {
					return CustomImage.updateOne(
						{ _id: image._id, userId },
						{
							$set: {
								folder: 'GENERAL',
								sortOrder: startingSortOrder + index
							}
						}
					);
				});

				await Promise.all(updatePromises);
			}
		} else if (strategy === 'deleteImages') {
			// Delete all images in the folder
			const imagesToDelete = await CustomImage.find({ userId, folder: folderName });

			// Delete from Cloudinary
			for (const image of imagesToDelete) {
				try {
					await cloudinary.uploader.destroy(image.cloudinaryPublicId);
				} catch (error) {
					console.error('Failed to delete image from Cloudinary:', error);
					// Continue with other deletions
				}
			}

			// Delete from database
			await CustomImage.deleteMany({ userId, folder: folderName });
		} else {
			// Default behavior: only delete if empty
			const imageCount = await CustomImage.countDocuments({ userId, folder: folderName });
			if (imageCount > 0) {
				return res.status(400).json({
					message: `Cannot delete folder with ${imageCount} image(s). Please delete or move the images first.`
				});
			}
		}

		// Delete the folder
		await CustomImageFolder.deleteOne({ _id: id, userId });
		res.json({ message: 'Folder deleted successfully' });
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to delete folder',
		});
	}
});

export default router;
