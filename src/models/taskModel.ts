import mongoose, { Schema, Document } from 'mongoose';

interface ITask extends Document {
	projectId?: Schema.Types.ObjectId;
	tagIds: Schema.Types.ObjectId[];
	sortOrder: number;
	title: string;
	completedTime?: Date | null;
	children: Schema.Types.ObjectId[];
	completedPomodoros: number;
	timeTaken: number;
	estimatedDuration: number;
	dueDate?: Date | null;
	description?: string;
	priority: number;
	status: string;
	progress: number;
	reminders: string[];
	comments?: Schema.Types.ObjectId[];
	isDeleted: Date | null;
	willNotDo: Date | null;
}

const TaskSchema: Schema = new Schema(
	{
		projectId: { type: Schema.Types.ObjectId, ref: 'Project', default: null },
		tagIds: [{ type: Schema.Types.ObjectId, ref: 'Tag', default: [] }],
		sortOrder: { type: Number, default: 0 },
		title: { type: String, required: true },
		completedTime: { type: Date, default: null },
		children: [{ type: Schema.Types.ObjectId, ref: 'Task' }],
		completedPomodoros: { type: Number, default: 0 },
		timeTaken: { type: Number, default: 0 },
		estimatedDuration: { type: Number, default: 0 },
		dueDate: { type: Date, default: null },
		description: { type: String, default: '' },
		priority: { type: Number, enum: [0, 1, 2, 3], default: 0 },
		status: { type: String, enum: ['not started', 'in-progress', 'complete'], default: 'not started' },
		progress: { type: Number, default: 0 },
		reminders: [{ type: String }],
		comments: [{ type: Schema.Types.ObjectId, ref: 'Comment' }],
		isDeleted: { type: Date, default: null },
		willNotDo: { type: Date, default: null },
	},
	{
		timestamps: true,
	}
);

// Alias `_id` to `id` for easier access
// Necessary when using dnd-kit on the frontend since they take "id", NOT "_id"
TaskSchema.virtual('id').get(function (task) {
	const id = this._id as any;
	return id.toHexString(); // Converts ObjectId to a string
});

TaskSchema.set('toObject', { virtuals: true }); // Include virtuals in `toObject`
TaskSchema.set('toJSON', { virtuals: true }); // Include virtuals in JSON output

const Task = mongoose.model<ITask>('Task', TaskSchema, 'tasks');

export default Task;
