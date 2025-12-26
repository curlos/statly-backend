import express from 'express';
import cloudinary from '../config/cloudinary';
import { upload } from '../middleware/multer';
import { verifyToken } from '../middleware/verifyToken';
import { CustomRequest } from '../interfaces/CustomRequest';
import CustomImage from '../models/CustomImageModel';
import UserSettings from '../models/UserSettingsModel';

const router = express.Router();

// GET /custom-images - Get all custom images for current user
router.get('/', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		const customImages = await CustomImage.find({ userId }).sort({ sortOrder: 1, createdAt: 1 });

		res.json(customImages);
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to fetch custom images',
		});
	}
});

// POST /custom-images/upload - Upload multiple images (max 10 per batch)
router.post('/upload', verifyToken, upload.array('images', 10), async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const files = req.files as Express.Multer.File[];
		const { folder = 'GENERAL' } = req.body; // Get folder from request body, default to GENERAL

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!files || files.length === 0) {
			return res.status(400).json({ message: 'No images provided' });
		}

		const normalizedFolder = folder.toUpperCase().trim();

		// Get current max sortOrder for this user in this folder
		const maxSortOrderDoc = await CustomImage.findOne({ userId, folder: normalizedFolder }).sort({ sortOrder: -1 }).select('sortOrder');
		const startingSortOrder = maxSortOrderDoc ? maxSortOrderDoc.sortOrder + 1 : 0;

		// Upload all files to Cloudinary in parallel
		const uploadResults = await Promise.allSettled(
			files.map((file, index) => {
				return new Promise<{ secure_url: string; public_id: string; index: number }>((resolve, reject) => {
					const stream = cloudinary.uploader.upload_stream(
						{
							resource_type: 'image',
							folder: `Statly/users/${userId}/custom-images`,
							public_id: `${Date.now()}-custom-${index}`,
							quality: 'auto:good',
							fetch_format: 'auto',
							width: 1000,
							height: 1000,
							crop: 'limit', // Don't upscale, maintain aspect ratio
						},
						(error, result) => {
							if (error) reject(error);
							else resolve({
								secure_url: result!.secure_url,
								public_id: result!.public_id,
								index
							});
						}
					);
					stream.end(file.buffer);
				});
			})
		);

		// Filter successful uploads and log failures
		const successfulUploads = uploadResults
			.map((result, i) => {
				if (result.status === 'rejected') {
					console.error(`Failed to upload image ${i}:`, result.reason);
					return null;
				}
				return result.value;
			})
			.filter((upload): upload is NonNullable<typeof upload> => upload !== null);

		if (successfulUploads.length === 0) {
			return res.status(500).json({ message: 'All uploads failed' });
		}

		// Batch insert all successful uploads to database
		const imagesToInsert = successfulUploads.map((upload) => ({
			userId,
			imageUrl: upload.secure_url,
			cloudinaryPublicId: upload.public_id,
			folder: normalizedFolder,
			sortOrder: startingSortOrder + upload.index,
		}));

		const uploadedImages = await CustomImage.insertMany(imagesToInsert);

		// Sort by sortOrder to maintain upload order
		uploadedImages.sort((a, b) => a.sortOrder - b.sortOrder);

		res.status(201).json(uploadedImages);
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to upload images',
		});
	}
});

// PUT /custom-images/reorder - Reorder images (MUST be before /:id route)
router.put('/reorder', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { imageIds } = req.body; // Array of image IDs in new order
 
		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!imageIds || !Array.isArray(imageIds)) {
			return res.status(400).json({ message: 'Invalid image IDs array' });
		}

		// Update sortOrder for each image
		const updatePromises = imageIds.map((imageId, index) => {
			return CustomImage.updateOne(
				{ _id: imageId, userId }, // Verify ownership
				{ sortOrder: index }
			);
		});

		await Promise.all(updatePromises);

		res.json({ message: 'Images reordered successfully' });
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to reorder images',
		});
	}
});

// PUT /custom-images/:id/move - Move image to different folder (MUST be before /:id route)
router.put('/:id/move', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { id } = req.params;
		const { folder } = req.body;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!folder) {
			return res.status(400).json({ message: 'Folder name required' });
		}

		const normalizedFolder = folder.toUpperCase().trim();

		// Find image and verify ownership
		const customImage = await CustomImage.findOne({ _id: id, userId });
		if (!customImage) {
			return res.status(404).json({ message: 'Custom image not found' });
		}

		// Update folder (only in database, not in Cloudinary)
		customImage.folder = normalizedFolder;

		// Reset sortOrder when moving to new folder
		// Get max sortOrder in destination folder
		const maxSortOrderDoc = await CustomImage.findOne({ userId, folder: normalizedFolder })
			.sort({ sortOrder: -1 })
			.select('sortOrder');
		customImage.sortOrder = maxSortOrderDoc ? maxSortOrderDoc.sortOrder + 1 : 0;

		await customImage.save();

		res.json(customImage);
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to move image',
		});
	}
});

// PUT /custom-images/:id - Replace a single image
router.put('/:id', verifyToken, upload.single('image'), async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { id } = req.params;
		const file = req.file;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!file) {
			return res.status(400).json({ message: 'No image provided' });
		}

		// Find the custom image and verify ownership
		const customImage = await CustomImage.findOne({ _id: id, userId });
		if (!customImage) {
			return res.status(404).json({ message: 'Custom image not found' });
		}

		// Save old image URL to check if it's used in user settings
		const oldImageUrl = customImage.imageUrl;

		// Delete old image from Cloudinary
		try {
			await cloudinary.uploader.destroy(customImage.cloudinaryPublicId);
		} catch (error) {
			console.error('Failed to delete old image from Cloudinary:', error);
			// Continue even if deletion fails
		}

		// Upload new image to Cloudinary
		const uploadResult: unknown = await new Promise((resolve, reject) => {
			const stream = cloudinary.uploader.upload_stream(
				{
					resource_type: 'image',
					folder: `Statly/users/${userId}/custom-images`,
					public_id: `${Date.now()}-custom-updated`,
					quality: 'auto:good',
					fetch_format: 'auto',
					width: 1000,
					height: 1000,
					crop: 'limit',
				},
				(error, result) => {
					if (error) reject(error);
					else resolve(result);
				}
			);
			stream.end(file.buffer);
		});

		const cloudinaryResult = uploadResult as { secure_url: string; public_id: string };
		const newImageUrl = cloudinaryResult.secure_url;

		// Update DB record
		customImage.imageUrl = newImageUrl;
		customImage.cloudinaryPublicId = cloudinaryResult.public_id;
		await customImage.save();

		// Check if old image URL is used in user settings and update if needed
		const userSettings = await UserSettings.findOne({ userId });
		if (userSettings) {
			let settingsUpdated = false;

			// Check and update focus records selected medal image
			if (userSettings.pages?.focusRecords?.selectedMedalImage === oldImageUrl) {
				if (!userSettings.pages.focusRecords) userSettings.pages.focusRecords = {};
				userSettings.pages.focusRecords.selectedMedalImage = newImageUrl;
				settingsUpdated = true;
			}

			// Check and update challenges selected images
			if (userSettings.pages?.challenges?.selectedChallengeCardImage?.focus === oldImageUrl) {
				if (!userSettings.pages.challenges) userSettings.pages.challenges = {};
				if (!userSettings.pages.challenges.selectedChallengeCardImage) {
					userSettings.pages.challenges.selectedChallengeCardImage = {};
				}
				userSettings.pages.challenges.selectedChallengeCardImage.focus = newImageUrl;
				settingsUpdated = true;
			}
			if (userSettings.pages?.challenges?.selectedChallengeCardImage?.tasks === oldImageUrl) {
				if (!userSettings.pages.challenges) userSettings.pages.challenges = {};
				if (!userSettings.pages.challenges.selectedChallengeCardImage) {
					userSettings.pages.challenges.selectedChallengeCardImage = {};
				}
				userSettings.pages.challenges.selectedChallengeCardImage.tasks = newImageUrl;
				settingsUpdated = true;
			}

			// Check and update medals selected images
			if (userSettings.pages?.medals?.selectedMedalCardImage?.focus === oldImageUrl) {
				if (!userSettings.pages.medals) userSettings.pages.medals = {};
				if (!userSettings.pages.medals.selectedMedalCardImage) {
					userSettings.pages.medals.selectedMedalCardImage = {};
				}
				userSettings.pages.medals.selectedMedalCardImage.focus = newImageUrl;
				settingsUpdated = true;
			}
			if (userSettings.pages?.medals?.selectedMedalCardImage?.tasks === oldImageUrl) {
				if (!userSettings.pages.medals) userSettings.pages.medals = {};
				if (!userSettings.pages.medals.selectedMedalCardImage) {
					userSettings.pages.medals.selectedMedalCardImage = {};
				}
				userSettings.pages.medals.selectedMedalCardImage.tasks = newImageUrl;
				settingsUpdated = true;
			}

			// Save settings if any were updated
			if (settingsUpdated) {
				await userSettings.save();
			}
		}

		res.json(customImage);
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to update image',
		});
	}
});

// DELETE /custom-images/bulk - Delete all images in a folder
router.delete('/bulk', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { folder } = req.query;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!folder || typeof folder !== 'string') {
			return res.status(400).json({ message: 'Folder name required' });
		}

		const normalizedFolder = folder.toUpperCase().trim();

		// Find all images in the folder for this user
		const imagesToDelete = await CustomImage.find({ userId, folder: normalizedFolder });

		if (imagesToDelete.length === 0) {
			return res.json({
				deletedCount: 0,
				cloudinaryFailures: 0,
				message: 'No images found in folder'
			});
		}

		// Delete from Cloudinary and database in parallel
		const [deleteResults, result] = await Promise.all([
			Promise.allSettled(
				imagesToDelete.map(image => cloudinary.uploader.destroy(image.cloudinaryPublicId))
			),
			CustomImage.deleteMany({ userId, folder: normalizedFolder })
		]);

		const cloudinaryFailures = deleteResults.filter(result => result.status === 'rejected').length;

		// Log any failures for debugging
		deleteResults.forEach((result, index) => {
			if (result.status === 'rejected') {
				console.error(`Failed to delete image from Cloudinary (${imagesToDelete[index].cloudinaryPublicId}):`, result.reason);
			}
		});

		res.json({
			deletedCount: result.deletedCount,
			cloudinaryFailures,
			message: `${result.deletedCount} image(s) deleted successfully${cloudinaryFailures > 0 ? ` (${cloudinaryFailures} Cloudinary deletion(s) failed)` : ''}`
		});
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to delete images',
		});
	}
});

// DELETE /custom-images/:id - Delete image
router.delete('/:id', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { id } = req.params;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		// Find the custom image and verify ownership
		const customImage = await CustomImage.findOne({ _id: id, userId });
		if (!customImage) {
			return res.status(404).json({ message: 'Custom image not found' });
		}

		// Delete from Cloudinary
		try {
			await cloudinary.uploader.destroy(customImage.cloudinaryPublicId);
		} catch (error) {
			console.error('Failed to delete image from Cloudinary:', error);
			// Continue with DB deletion even if Cloudinary deletion fails
		}

		// Delete from database
		await CustomImage.deleteOne({ _id: id, userId });

		res.json({ message: 'Image deleted successfully' });
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to delete image',
		});
	}
});

export default router;
