import mongoose, { Schema, Document, ObjectId } from 'mongoose';

interface IFocusRecord extends Document {
	taskId?: ObjectId; // Using ObjectId from mongoose, optional because required is set to false
	habitId?: ObjectId; // Also optional
	startTime: Date; // Required
	endTime: Date; // Required
	duration?: number; // Optional
	note: string; // Default is an empty string, but always present
	pomos: number; // Always present, with a default value
	focusType: 'pomo' | 'stopwatch'; // Enum type restricted to 'pomo' or 'stopwatch', with a default
	children: ObjectId[]; // Array of ObjectId references, always present
}

const focusRecordSchema = new Schema(
	{
		taskId: {
			type: Schema.Types.ObjectId,
			ref: 'Task',
			required: false,
		},
		habitId: {
			type: Schema.Types.ObjectId,
			ref: 'Habit',
			required: false,
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
			required: false,
		},
		note: {
			type: String,
			default: '',
		},
		pomos: {
			type: Number,
			default: 0,
		},
		focusType: {
			type: String,
			required: true,
			enum: ['pomo', 'stopwatch'],
			default: 'stopwatch',
		},
		children: [{ type: Schema.Types.ObjectId, ref: 'FocusRecord' }],
	},
	{
		timestamps: true,
	}
);

focusRecordSchema.index({ task: 1, startTime: -1 });

const FocusRecord = mongoose.model<IFocusRecord>('FocusRecord', focusRecordSchema);

export default FocusRecord;
