import mongoose, { Schema } from 'mongoose';
import { applyUserIdEnforcement } from '../utils/schema.utils';

// Base embedded schema for tasks within a focus record (common fields for all apps)
const BaseFocusRecordTaskSchema = new Schema({
	taskId: {
		type: String,
		required: true,
		index: true, // Index for fast lookup when updating focus records during task sync
	},
	title: {
		type: String,
		required: true,
	},
	startTime: {
		type: Date,
		required: true,
	},
	endTime: {
		type: Date,
		required: true,
	},
	duration: {
		type: Number,
		required: true,
	},
	projectId: {
		type: String,
		required: true,
		index: true, // Index for fast filtering
	},
	projectName: {
		type: String,
		required: true,
	},
}, { _id: false }); // Disable _id for embedded documents

// Extended schema for TickTick tasks (inherits base fields and adds project-related fields)
const TickTickFocusRecordTaskSchema = new Schema({
	...BaseFocusRecordTaskSchema.obj,
	ancestorIds: {
		type: [String],
		default: [],
		index: true, // Index for fast filtering by ancestors
	},
}, { _id: false });

// Extended schema for Session tasks (inherits base fields and adds project-related fields)
const SessionFocusRecordTaskSchema = new Schema({
	...BaseFocusRecordTaskSchema.obj,
}, { _id: false });

// Base schema with shared fields for ALL focus records
const BaseFocusRecordSchema = new Schema({
	id: {
		type: String,
		required: true,
		index: true,
	},
	userId: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true,
		index: true
	},
	source: {
		type: String,
		required: true,
		index: true
	},
	startTime: {
		type: Date,
		required: true,
		index: true,
	},
	endTime: {
		type: Date,
		required: true,
	},
	duration: {
		type: Number,
		required: true,
	},
	crossesMidnight: {
		type: Boolean,
		default: false,
		index: true, // Index for fast filtering
	},
	emotions: {
		type: [{
			emotion: String,  // 'joy', 'sadness', 'anger', 'fear', 'surprise', 'disgust', 'neutral'
			score: Number     // confidence 0-1
		}],
		_id: false  // Disable _id for emotion array items
	},
}, {
	collection: 'focusRecords',
	discriminatorKey: 'source',
	timestamps: false
});

// Add compound unique index to ensure id is unique per user (not globally unique)
BaseFocusRecordSchema.index({ id: 1, userId: 1 }, { unique: true });

// Add compound indexes for common query patterns (userId is always first since all queries filter by user)
BaseFocusRecordSchema.index({ userId: 1, startTime: -1 });
BaseFocusRecordSchema.index({ userId: 1, source: 1 });
BaseFocusRecordSchema.index({ userId: 1, 'tasks.projectId': 1 });
BaseFocusRecordSchema.index({ userId: 1, 'tasks.taskId': 1 });
BaseFocusRecordSchema.index({ userId: 1, crossesMidnight: 1 });

// Apply userId enforcement middleware
applyUserIdEnforcement(BaseFocusRecordSchema);

// Create base model
const FocusRecord = mongoose.model('FocusRecord', BaseFocusRecordSchema);

// TickTick-specific schema (discriminator for TickTick focus records)
const TickTickFocusRecordSchema = new Schema({
	note: {
		type: String,
	},
	tasks: [TickTickFocusRecordTaskSchema],
	pauseDuration: {
		type: Number,
		default: 0,
	}
});

// Create TickTick discriminator
const FocusRecordTickTick = FocusRecord.discriminator('FocusRecordTickTick', TickTickFocusRecordSchema);

// BeFocused-specific schema (discriminator for BeFocused focus records)
const BeFocusedFocusRecordSchema = new Schema({
	tasks: [BaseFocusRecordTaskSchema],
});

// Create BeFocused discriminator
const FocusRecordBeFocused = FocusRecord.discriminator('FocusRecordBeFocused', BeFocusedFocusRecordSchema);

// Forest-specific schema (discriminator for Forest focus records)
const ForestFocusRecordSchema = new Schema({
	note: {
		type: String,
		default: '',
	},
	treeType: {
		type: String,
		default: '',
	},
	isSuccess: {
		type: Boolean,
		required: true,
	},
	tasks: [BaseFocusRecordTaskSchema],
});

// Create Forest discriminator
const FocusRecordForest = FocusRecord.discriminator('FocusRecordForest', ForestFocusRecordSchema);

// Tide-specific schema (discriminator for Tide focus records)
const TideFocusRecordSchema = new Schema({
	tasks: [BaseFocusRecordTaskSchema],
});

// Create Tide discriminator
const FocusRecordTide = FocusRecord.discriminator('FocusRecordTide', TideFocusRecordSchema);

// Session-specific schema (discriminator for Session focus records)
const SessionFocusRecordSchema = new Schema({
	note: {
		type: String,
		default: '',
	},
	pauseDuration: {
		type: Number,
		default: 0,
	},
	tasks: [SessionFocusRecordTaskSchema],
});

// Create Session discriminator
const FocusRecordSession = FocusRecord.discriminator('FocusRecordSession', SessionFocusRecordSchema);

export { FocusRecord, FocusRecordTickTick, FocusRecordBeFocused, FocusRecordForest, FocusRecordTide, FocusRecordSession };
export default FocusRecord;
