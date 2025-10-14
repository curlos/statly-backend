import mongoose, { Schema } from 'mongoose';

// Base embedded schema for tasks within a focus record (common fields for all apps)
const BaseFocusRecordTaskSchema = new Schema({
	taskId: {
		type: String,
		required: true,
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
}, { _id: false }); // Disable _id for embedded documents

// Extended schema for TickTick tasks (inherits base fields and adds project-related fields)
const TickTickFocusRecordTaskSchema = new Schema({
	...BaseFocusRecordTaskSchema.obj,
	projectId: {
		type: String,
		required: true,
		index: true, // Index for fast filtering
	},
	projectName: {
		type: String,
		required: true,
	},
	ancestorIds: {
		type: [String],
		default: [],
		index: true, // Index for fast filtering by ancestors
	},
}, { _id: false });

// Base schema with shared fields for ALL focus records
const BaseFocusRecordSchema = new Schema({
	id: {
		type: String,
		required: true,
		unique: true,
		index: true,
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
}, {
	collection: 'focus-records',
	discriminatorKey: 'source',
	timestamps: false
});

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

export { FocusRecord, FocusRecordTickTick, FocusRecordBeFocused };
export default FocusRecord;
