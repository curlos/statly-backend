import mongoose, { Schema } from 'mongoose';

// Base schema with NORMALIZED shared fields for ALL tasks (TickTick and Todoist)
const BaseTaskSchema = new Schema({
	id: {
		type: String,
		required: true,
		index: true
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
	title: {
		type: String,
		required: true
	},
	description: {
		type: String,
		default: ''
	},
	projectId: {
		type: String,
		index: true
	},
	parentId: {
		type: String,
		index: true
	},
	completedTime: {
		type: Date,
		index: true
	},
	sortOrder: {
		type: Number
	},
	timeZone: {
		type: String
	},
	ancestorIds: {
		type: [String],
		default: []
	},
	ancestorSet: {
		type: Map,
		of: Boolean,
		default: {}
	}
}, {
	collection: 'tasks',
	discriminatorKey: 'source',
	timestamps: false
});

// Add compound unique index to ensure id is unique per user (not globally unique)
BaseTaskSchema.index({ id: 1, userId: 1 }, { unique: true });

// Add compound indexes for optimal query performance (userId is always first since all queries filter by user)
BaseTaskSchema.index({ userId: 1, completedTime: 1 });
BaseTaskSchema.index({ userId: 1, source: 1, projectId: 1 });

// Create base model
const Task = mongoose.model('Task', BaseTaskSchema);

// TickTick-specific schema (discriminator for TickTick tasks)
const TickTickTaskSchema = new Schema({
	taskType: {
		type: String,
		required: true,
		enum: ['full', 'item'],
		index: true
	},
	content: {
		type: String,
		default: ''
	},
	desc: {
		type: String,
		default: ''
	},
	completedUserId: {
		type: Number
	},
	modifiedTime: {
		type: Date,
		index: true
	},
	createdTime: {
		type: Date,
		index: true
	},
	creator: {
		type: Number
	},
	startDate: {
		type: Date
	},
	status: {
		type: Number
	}
});

// Todoist-specific schema (discriminator for Todoist tasks)
const TodoistTaskSchema = new Schema({
	added_at: {
		type: Date,
		index: true
	},
	added_by_uid: {
		type: String
	},
	assigned_by_uid: {
		type: String
	},
	checked: {
		type: Boolean,
		default: false
	},
	child_order: {
		type: Number
	},
	collapsed: {
		type: Boolean,
		default: false
	},
	day_order: {
		type: Number
	},
	deadline: {
		type: Date
	},
	due: {
		type: Schema.Types.Mixed
	},
	duration: {
		type: Schema.Types.Mixed
	},
	is_deleted: {
		type: Boolean,
		default: false
	},
	labels: {
		type: [String],
		default: []
	},
	note_count: {
		type: Number,
		default: 0
	},
	priority: {
		type: Number,
		default: 1,
		index: true
	},
	responsible_uid: {
		type: String
	},
	section_id: {
		type: String
	},
	sync_id: {
		type: String
	},
	updated_at: {
		type: Date
	},
	user_id: {
		type: String,
		required: true
	},
	v2_id: {
		type: String,
		index: true
	},
	v2_parent_id: {
		type: String,
		index: true
	},
	v2_project_id: {
		type: String,
		index: true
	},
	v2_section_id: {
		type: String
	}
});

// Create discriminators
const TaskTickTick = Task.discriminator('TaskTickTick', TickTickTaskSchema);
const TaskTodoist = Task.discriminator('TaskTodoist', TodoistTaskSchema);

export { Task, TaskTickTick, TaskTodoist };
export default Task;
