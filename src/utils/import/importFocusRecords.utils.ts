import { Types, Model } from 'mongoose';
import { FocusRecordTickTick, FocusRecordBeFocused, FocusRecordForest, FocusRecordTide, FocusRecordSession } from "../../models/FocusRecord";
import { isValidDate, ImportCategoryResult } from "./importBackup.utils";
import { ImportableFocusRecordDocument } from '../../types/import';

/**
 * Validates a focus record document against required fields
 */
export function validateFocusRecord(doc: ImportableFocusRecordDocument, requiredFields: string[], validSourcesSet: Set<string>): { valid: boolean; error?: string } {
    for (const field of requiredFields) {
        if (!(field in doc)) {
            return { valid: false, error: `Missing required field: ${field}` };
        }
    }

    if (!validSourcesSet.has(doc.source)) {
        return { valid: false, error: `Invalid source: ${doc.source}` };
    }

    // Validate dates
    if (!isValidDate(doc.startTime) || !isValidDate(doc.endTime)) {
        return { valid: false, error: 'Invalid date format for startTime or endTime' };
    }

    // Validate duration is a number
    if (typeof doc.duration !== 'number') {
        return { valid: false, error: 'Duration must be a number' };
    }

    // Validate tasks is an array
    if (!Array.isArray(doc.tasks)) {
        return { valid: false, error: 'Tasks must be an array' };
    }

    return { valid: true };
}

/**
 * Imports focus records with validation
 */
export async function importFocusRecords(records: ImportableFocusRecordDocument[], userId: Types.ObjectId): Promise<ImportCategoryResult> {
    const errors: string[] = [];

    // Declare validation constants once for all records
    const requiredFields = ['id', 'source', 'startTime', 'endTime', 'duration', 'tasks'];
    const validSourcesSet = new Set([
        'FocusRecordTickTick',
        'FocusRecordBeFocused',
        'FocusRecordForest',
        'FocusRecordTide',
        'FocusRecordSession',
    ]);

    // Group records by source to use the correct discriminator model
    const recordsBySource: Record<string, ImportableFocusRecordDocument[]> = {
        FocusRecordTickTick: [],
        FocusRecordBeFocused: [],
        FocusRecordForest: [],
        FocusRecordTide: [],
        FocusRecordSession: [],
    };

    // Validate and categorize records
    for (const record of records) {
        const validation = validateFocusRecord(record, requiredFields, validSourcesSet);

        if (!validation.valid) {
            errors.push(`Focus record ${record.id || 'unknown'}: ${validation.error}`);
            continue;
        }

        const source = record.source;
        if (recordsBySource[source]) {
            // Remove _id to allow MongoDB to generate new unique IDs for each user
            const { _id, ...recordWithoutMongoDbId } = record;
            recordsBySource[source].push({ ...recordWithoutMongoDbId, userId });
        } else {
            errors.push(`Focus record ${record.id}: Unknown source ${source}`);
        }
    }

    // Map source names to their corresponding discriminator models
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const modelMap: Record<string, Model<any>> = {
        FocusRecordTickTick,
        FocusRecordBeFocused,
        FocusRecordForest,
        FocusRecordTide,
        FocusRecordSession,
    };

    let totalCreated = 0;
    let totalModified = 0;
    let totalMatched = 0;

    // Import each source separately using the correct discriminator model
    for (const [source, sourceRecords] of Object.entries(recordsBySource)) {
        if (sourceRecords.length === 0) continue;

        const bulkOps = sourceRecords.map(record => ({
            updateOne: {
                filter: { id: record.id, userId },
                update: { $set: record },
                upsert: true,
            },
        }));

        try {
            const model = modelMap[source];
            const result = await model.bulkWrite(bulkOps);
            totalCreated += result.upsertedCount;
            totalModified += result.modifiedCount;
            totalMatched += result.matchedCount - result.modifiedCount;
        } catch (error) {
            errors.push(`Bulk insert error for ${source}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    return {
        created: totalCreated,
        modified: totalModified,
        matched: totalMatched,
        failed: errors.length,
        errors,
    };
}