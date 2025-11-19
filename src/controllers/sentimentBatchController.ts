import { Request, Response } from 'express';
import FocusRecord from '../models/FocusRecord';
import axios from 'axios';
import mongoose from 'mongoose';

interface EmotionResult {
	emotion: string;
	score: number;
}

interface RecordToAnalyze {
	id: string;
	note: string;
}

interface AnalysisResult {
	id: string;
	emotions: EmotionResult[];
	skipped: boolean;
}

interface HuggingFaceResponse {
	results: AnalysisResult[];
}

const HUGGINGFACE_SPACE_URL = process.env.HUGGINGFACE_SPACE_URL;

/**
 * GET /api/focus-records/analyze-sentiment/ids
 * Returns array of record IDs that need sentiment analysis
 */
export async function getFocusRecordsNeedingSentiment(req: Request, res: Response) {
	try {
		// Find all records that need sentiment analysis
		// Records need analysis if:
		// 1. They don't have an "emotions" field OR
		// 2. "emotions" is empty/null
		// 3. AND they have a non-empty "note" field
		const records = await FocusRecord.find({
			$and: [
				{
					$or: [
						{ 'emotions': { $exists: false } },
						{ 'emotions': { $size: 0 } },
						{ 'emotions': null }
					]
				},
				{ 'note': { $exists: true } },
				{ 'note': { $ne: '' } }
			]
		}).select('_id').lean();

		const recordIds = records.map(record => record._id.toString());

		res.status(200).json({
			recordIds
		});
	} catch (error) {
		console.error('Error fetching records needing sentiment:', error);
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred while fetching records'
		});
	}
}

/**
 * POST /api/focus-records/analyze-note-emotions
 * Analyzes sentiment for a specific batch of record IDs
 * Body: { recordIds: string[] }
 */
export async function analyzeNoteEmotionsHandler(req: Request, res: Response) {
	try {
		const { recordIds } = req.body;

		if (!recordIds || !Array.isArray(recordIds) || recordIds.length === 0) {
			return res.status(400).json({
				message: 'recordIds array is required and must not be empty'
			});
		}

		if (!HUGGINGFACE_SPACE_URL) {
			throw new Error('HUGGINGFACE_SPACE_URL environment variable is not set');
		}

		console.log(`Analyzing ${recordIds.length} records...`);

		// Fetch the specific records by ID
		const records = await FocusRecord.find({
			_id: { $in: recordIds }
		}).select('_id note').lean();

		if (records.length === 0) {
			return res.status(404).json({
				message: 'No records found with provided IDs'
			});
		}

		// Prepare records for analysis
		const recordsData: RecordToAnalyze[] = records.map(record => ({
			id: record._id.toString(),
			note: (record as any).note || ''
		}));

		// Call HuggingFace API
		const payload = {
			records: recordsData.map(r => ({
				id: r.id,
				note: r.note,
				emotion: null  // Always analyze, never skip
			}))
		};

		const endpoint = `${HUGGINGFACE_SPACE_URL}/analyze`;
		console.log(`🔗 Calling HuggingFace endpoint: ${endpoint}`);
		console.log(`📦 Payload: ${recordsData.length} records`);

		const response = await axios.post(
			endpoint,
			payload,
			{
				headers: { 'Content-Type': 'application/json' },
				timeout: 240000 // 4 minutes timeout
			}
		);

		const result: HuggingFaceResponse = response.data;
		const analysisResults = result.results;

		// Update database with results using bulk operation
		const bulkOperations = [];
		let failedCount = 0;

		for (const analysisResult of analysisResults) {
			if (analysisResult.skipped) {
				continue;
			}

			// Check if this is an error result
			const isError = analysisResult.emotions.some(e => e.emotion === 'error');

			if (isError) {
				failedCount++;
				continue;
			}

			bulkOperations.push({
				updateOne: {
					filter: { _id: new mongoose.Types.ObjectId(analysisResult.id) },
					update: {
						$set: {
							'emotions': analysisResult.emotions as any
						}
					}
				}
			});
		}

		let analyzedCount = 0;

		if (bulkOperations.length > 0) {
			try {
				const bulkResult = await FocusRecord.bulkWrite(bulkOperations);
				analyzedCount = bulkResult.modifiedCount;
			} catch (error) {
				console.error('Failed to bulk update records:', error);
				failedCount += bulkOperations.length;
			}
		}

		console.log(`✅ Completed: ${analyzedCount} analyzed, ${failedCount} failed`);

		res.status(200).json({
			analyzed: analyzedCount,
			failed: failedCount
		});
	} catch (error: any) {
		console.error('Error analyzing note emotions:', error);

		// Provide detailed error information
		if (error.response) {
			return res.status(500).json({
				message: `HuggingFace API error: ${error.response.status}`,
				analyzed: 0,
				failed: req.body.recordIds?.length || 0
			});
		} else if (error.request) {
			return res.status(500).json({
				message: 'HuggingFace API: No response received (timeout or connection error)',
				analyzed: 0,
				failed: req.body.recordIds?.length || 0
			});
		}

		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred during sentiment analysis',
			analyzed: 0,
			failed: req.body.recordIds?.length || 0
		});
	}
}
