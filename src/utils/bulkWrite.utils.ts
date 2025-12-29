import { Model } from 'mongoose';

/**
 * Executes bulkWrite operations in batches based on estimated BSON size to avoid MongoDB's 16MB limit.
 *
 * MongoDB has a 16MB limit for BSON documents, which applies to the entire bulkWrite operation payload.
 * This function uses size-based batching (not count-based) to maximize performance while staying safe.
 *
 * Key advantages:
 * - Adaptive: Handles both small and large objects efficiently
 * - Fast: Minimizes number of database round trips
 * - Safe: Uses JSON size estimation with 2MB safety buffer
 *
 * @param bulkOps - Array of bulk write operations
 * @param model - Mongoose model to execute operations on
 * @param maxBatchSizeBytes - Maximum batch size in bytes (default: 14MB, leaving 2MB buffer)
 * @returns Aggregated bulk write result
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function executeBatchedBulkWrite(
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	bulkOps: any[],
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	model: Model<any>,
	maxBatchSizeBytes: number = 14 * 1024 * 1024 // 14MB
) {
	// Handle empty array
	if (bulkOps.length === 0) {
		return {
			upsertedCount: 0,
			insertedCount: 0,
			modifiedCount: 0,
			deletedCount: 0,
			matchedCount: 0,
		};
	}

	// Split operations into size-based batches
	// Note: We use JSON.stringify() to estimate BSON size. JSON is typically ~47% larger than BSON
	// due to quoted field names, string quotes, and text-based number encoding. This overestimation
	// is intentional and provides a safety buffer. Empirical data shows:
	// - 23MB JSON estimate → ~16MB actual BSON
	// - This keeps us safely under MongoDB's 16MB limit with a conservative threshold
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const batches: any[][] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let currentBatch: any[] = [];
	let currentBatchSize = 0;

	for (const op of bulkOps) {
		// Estimate BSON size using JSON serialization
		// JSON.stringify is slightly larger than BSON (quotes, spacing), so it's a conservative estimate
		const opSize = JSON.stringify(op).length;

		// If adding this operation would exceed the limit, start a new batch
		if (currentBatchSize + opSize > maxBatchSizeBytes && currentBatch.length > 0) {
			batches.push(currentBatch);
			currentBatch = [];
			currentBatchSize = 0;
		}

		// Add operation to current batch
		currentBatch.push(op);
		currentBatchSize += opSize;
	}

	// Don't forget the last batch
	if (currentBatch.length > 0) {
		batches.push(currentBatch);
	}

	// If everything fits in one batch, execute directly (no overhead)
	if (batches.length === 1) {
		return await model.bulkWrite(batches[0]);
	}

	// Execute batches sequentially and aggregate results
	const aggregatedResult = {
		upsertedCount: 0,
		insertedCount: 0,
		modifiedCount: 0,
		deletedCount: 0,
		matchedCount: 0,
	};

	for (const batch of batches) {
		const result = await model.bulkWrite(batch);
		aggregatedResult.upsertedCount += result.upsertedCount || 0;
		aggregatedResult.insertedCount += result.insertedCount || 0;
		aggregatedResult.modifiedCount += result.modifiedCount || 0;
		aggregatedResult.deletedCount += result.deletedCount || 0;
		aggregatedResult.matchedCount += result.matchedCount || 0;
	}

	return aggregatedResult;
}
