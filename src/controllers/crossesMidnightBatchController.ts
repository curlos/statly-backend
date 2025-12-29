import { Response } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import FocusRecord from '../models/FocusRecord';
import mongoose, { Types } from 'mongoose';
import { crossesMidnightInTimezone } from '../utils/timezone.utils';
import { executeBatchedBulkWrite } from '../utils/bulkWrite.utils';

interface RevalidationResult {
	updated: number;
	unchanged: number;
	failed: number;
	falseToTrue: number;
	trueToFalse: number;
}

/**
 * Core function to revalidate crossesMidnight for all records
 * @param timezone - User's timezone for calculation
 * @returns Object with detailed statistics
 */
export async function revalidateCrossesMidnightCore(
	timezone: string,
	userId: Types.ObjectId
): Promise<RevalidationResult> {
	if (!timezone) {
		throw new Error('timezone is required');
	}

	// Fetch all records with necessary fields
	const records = await FocusRecord.find({ userId })
		.select('_id startTime endTime crossesMidnight')
		.lean();

	if (records.length === 0) {
		throw new Error('No records found');
	}

	console.log(`Revalidating ${records.length} records for timezone: ${timezone}`);

	// Track statistics
	let falseToTrue = 0;
	let trueToFalse = 0;
	let unchanged = 0;
	let failedCount = 0;

	// Prepare bulk operations
	const bulkOperations = [];

	for (const record of records) {
		try {
			const startTime = new Date(record.startTime);
			const endTime = new Date(record.endTime);
			const currentValue = record.crossesMidnight || false;

			// Calculate new value
			const newValue = crossesMidnightInTimezone(startTime, endTime, timezone);

			// Only update if value changed
			if (currentValue !== newValue) {
				bulkOperations.push({
					updateOne: {
						filter: { _id: new mongoose.Types.ObjectId(record._id) },
						update: {
							$set: {
								crossesMidnight: newValue
							}
						}
					}
				});

				// Track transition type
				if (!currentValue && newValue) {
					falseToTrue++;
				} else if (currentValue && !newValue) {
					trueToFalse++;
				}
			} else {
				unchanged++;
			}
		} catch (error) {
			console.error(`Failed to process record ${record._id}:`, error);
			failedCount++;
		}
	}

	let updatedCount = 0;

	// Execute bulk operations if there are any changes
	if (bulkOperations.length > 0) {
		try {
			const bulkResult = await executeBatchedBulkWrite(bulkOperations, FocusRecord);
			updatedCount = bulkResult.modifiedCount;
		} catch (error) {
			console.error('Failed to bulk update records:', error);
			failedCount += bulkOperations.length;
			// Reset transition counts since updates failed
			const totalFailed = falseToTrue + trueToFalse;
			falseToTrue = 0;
			trueToFalse = 0;
			failedCount = totalFailed;
		}
	}

	console.log(`✅ Completed: ${updatedCount} updated, ${unchanged} unchanged, ${failedCount} failed`);
	console.log(`   Transitions: ${falseToTrue} false→true, ${trueToFalse} true→false`);

	return {
		updated: updatedCount,
		unchanged,
		failed: failedCount,
		falseToTrue,
		trueToFalse
	};
}

/**
 * POST /api/focus-records/revalidate-crosses-midnight
 * Revalidates crossesMidnight for all records
 * Body: { timezone: string }
 */
export async function revalidateCrossesMidnightHandler(req: CustomRequest, res: Response) {
	try {
		const { timezone } = req.body;
		const userId = req.user!.userId;

		if (!timezone) {
			return res.status(400).json({
				message: 'timezone is required'
			});
		}

		// Call the core function
		const result = await revalidateCrossesMidnightCore(timezone, userId);

		res.status(200).json(result);
	} catch (error) {
		console.error('Error revalidating crossesMidnight:', error);
		const message = error instanceof Error ? error.message : 'An error occurred during revalidation';

		res.status(500).json({
			message,
			updated: 0,
			unchanged: 0,
			failed: 0,
			falseToTrue: 0,
			trueToFalse: 0
		});
	}
}
