import express from 'express';
import FocusRecordTickTick from '../../models/FocusRecordTickTickModel';
import { verifyToken } from '../../middleware/verifyToken';
import { getJsonData } from '../../utils/mongoose.utils';

const router = express.Router();

router.get('/focus-records', verifyToken, async (req, res) => {
	try {
		const page = parseInt(req.query.page as string) || 0;
		const limit = parseInt(req.query.limit as string) || 50;
		const skip = page * limit;

		// Get total count for pagination metadata
		const total = await FocusRecordTickTick.countDocuments();
		const totalPages = Math.ceil(total / limit);

		// Fetch paginated focus records sorted by startTime descending (newest first)
		const focusRecords = await FocusRecordTickTick.find()
			.sort({ startTime: -1 })
			.skip(skip)
			.limit(limit)
			.lean(); // Use lean() for better performance when we don't need Mongoose documents

		const hasMore = skip + focusRecords.length < total;

		res.status(200).json({
			data: focusRecords,
			total,
			totalPages,
			page,
			limit,
			hasMore,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching focus records.',
		});
	}
});

router.get('/test-json-data', verifyToken, async (req, res) => {
	try {
		const jsonData = await getJsonData('sorted-all-focus-data');
		res.status(200).json(jsonData);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching JSON data.',
		});
	}
});

router.post('/transfer-focus-records', verifyToken, async (req, res) => {
	try {
		const jsonData = await getJsonData('sorted-all-focus-data');
		const first10Records = jsonData.slice(0, 125);

		const insertedRecords = [];
		const skippedRecords = [];

		for (const record of first10Records) {
			// Check if record already exists by id
			const existingRecord = await FocusRecordTickTick.findOne({ id: record.id });

			if (existingRecord) {
				skippedRecords.push(record.id);
			} else {
				// Insert new record
				const newRecord = new FocusRecordTickTick(record);
				await newRecord.save();
				insertedRecords.push(record.id);
			}
		}

		res.status(200).json({
			message: 'Transfer complete',
			inserted: insertedRecords.length,
			skipped: skippedRecords.length,
			insertedIds: insertedRecords,
			skippedIds: skippedRecords,
		});
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred transferring focus records.',
		});
	}
});

export default router;
