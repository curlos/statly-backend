// src/routes/taskRouter.ts
import express from 'express';
import FocusRecord from '../models/FocusRecordModel';
const router = express.Router();

router.get('/', async (req, res) => {
	try {
		const focusRecords = await FocusRecord.find({});
		res.status(200).json(focusRecords);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the tasks',
		});
	}
});

router.post('/add', async (req, res) => {
	try {
		// Check if both taskId and habitId are provided
		const { taskId, habitId } = req.body;
		if (taskId && habitId) {
			return res.status(400).json({ message: 'A focus record can only have a taskId or a habitId, not both.' });
		}

		const newFocusRecord = new FocusRecord({
			...req.body,
		});

		const savedFocusRecord = await newFocusRecord.save();

		return res.status(201).json(savedFocusRecord);
	} catch (error) {
		return res.status(400).json({
			message: error instanceof Error ? error.message : 'An error occurred during focus record creation',
		});
	}
});

router.put('/edit/:focusRecordId', async (req, res) => {
	const { focusRecordId } = req.params;
	let updateData = req.body;

	try {
		// Check if both taskId and habitId are provided in the update data
		const { taskId, habitId } = updateData;
		if (taskId && habitId) {
			return res.status(400).json({ message: 'A focus record can only have a taskId or a habitId, not both.' });
		}

		const updatedFocusRecord = await FocusRecord.findByIdAndUpdate(focusRecordId, updateData, {
			new: true,
			runValidators: true,
		});

		if (!updatedFocusRecord) {
			return res.status(404).json({ message: 'Focus Record not found' });
		}

		return res.status(200).json(updatedFocusRecord);
	} catch (error) {
		return res
			.status(400)
			.json({ message: error instanceof Error ? error.message : 'An error occurred during focus record update' });
	}
});

router.delete('/delete/:focusRecordId', async (req, res) => {
	const { focusRecordId } = req.params;

	try {
		const deletedFocusRecord = await FocusRecord.findByIdAndDelete(focusRecordId);

		if (!deletedFocusRecord) {
			return res.status(404).json({ message: 'Focus Record not found' });
		}

		return res.status(200).json({ message: 'Focus Record successfully deleted' });
	} catch (error) {
		return res.status(400).json({
			message:
				error instanceof Error ? error.message : 'An error occurred during the deletion of the focus record',
		});
	}
});

// This is needed because if a user pauses a focus record, we need to know when they pick back up. There were a couple of ways to do this but the easiest way I saw to do it while also having the ability to edit individual focus record tasks, is to just create new focus records every time it's paused. When the timer is done, the "/bulk-add" endpoint can be called to add all the focus records together under one Focus Record Summary.
router.post('/bulk-add', async (req, res) => {
	const focusRecords = req.body.focusRecords;
	const focusNote = req.body.focusNote;

	if (!Array.isArray(focusRecords) || focusRecords.length === 0) {
		return res.status(400).json({ message: 'Invalid input: expected an array of focus records.' });
	}

	try {
		// Bulk insert the array of focus records
		const insertedRecords = await FocusRecord.insertMany(focusRecords);

		// Extract the IDs of the newly added records
		const childrenIds = insertedRecords.map((record) => record._id);

		const isTask = focusRecords[0].taskId;

		// Create a new focus record that references the IDs of the records just added
		// TODO: May have to refactor this so that the first task shown is perhaps different? Maybe show the task I worked for the longest duration combined in the title.
		const summaryFocusRecord = new FocusRecord({
			taskId: isTask ? focusRecords[0].taskId : null,
			habitId: !isTask ? focusRecords[0].habitId : null,
			startTime: focusRecords[0].startTime,
			endTime: focusRecords[focusRecords.length - 1].endTime,
			duration: focusRecords.reduce((total, record) => {
				return total + (record.duration || 0);
			}, 0),
			focusType: focusRecords[0].focusType,
			note: focusNote,
			pomos: focusRecords[0].focusType === 'pomo' ? 1 : 0,
			children: childrenIds,
		});

		const savedSummaryFocusRecord = await summaryFocusRecord.save();

		// Return the IDs of all new records including the summary record
		return res.status(201).json({
			message: 'Focus records and summary focus record added successfully.',
			insertedRecords,
			savedSummaryFocusRecord,
		});
	} catch (error) {
		return res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred during the bulk add operation',
		});
	}
});

export default router;
