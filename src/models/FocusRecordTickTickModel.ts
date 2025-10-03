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
}, { _id: false }); // Disable _id for embedded documents

// Main TickTick Focus Record schema
const FocusRecordTickTickSchema = new Schema({
	id: {
		type: String,
		required: true,
		unique: true,
		index: true,
	},
	note: {
		type: String,
	},
	tasks: [FocusRecordTaskSchema],
	status: {
		type: Number,
	},
	startTime: {
		type: Date,
		required: true,
		index: true, // Index for efficient sorting
	},
	endTime: {
		type: Date,
		required: true,
	},
	pauseDuration: {
		type: Number,
		default: 0,
	},
	adjustTime: {
		type: Number,
		default: 0,
	},
	added: {
		type: Boolean,
		default: false,
	},
	etag: {
		type: String,
	},
	duration: {
		type: Number,
		required: true,
	},
	relationType: {
		type: [Number],
	},
}, { collection: 'focus-records-ticktick' }); // Specify collection name

const FocusRecordTickTick = mongoose.model('FocusRecordTickTick', FocusRecordTickTickSchema);

export default FocusRecordTickTick;
