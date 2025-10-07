import mongoose, { Schema } from 'mongoose';

// Embedded schema for tasks within a focus record
const FocusRecordTaskSchema = new Schema({
	taskId: {
		type: String,
		required: true,
	},
	title: {
		type: String,
		required: true,
	},
	projectName: {
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
	tasks: [FocusRecordTaskSchema],
	pauseDuration: {
		type: Number,
		default: 0,
	}
});

// Create discriminator
const FocusRecordTickTick = FocusRecord.discriminator('FocusRecordTickTick', TickTickFocusRecordSchema);

export { FocusRecord, FocusRecordTickTick };
export default FocusRecord;
