import mongoose, { Schema } from 'mongoose';

// Base schema with NORMALIZED shared fields for ALL projects (TickTick, Todoist, and Session)
const BaseProjectSchema = new Schema({
	id: {
		type: String,
		required: true,
		unique: true,
		index: true
	},
	source: {
		type: String,
		required: true,
		index: true
	},
	name: {
		type: String,
		required: true
	},
	color: {
		type: String
	},
	sortOrder: {
		type: Number
	},
	viewMode: {
		type: String
	},
	closed: {
		type: Boolean,
		index: true
	},
	groupId: {
		type: String,
		index: true
	},
	parentId: {
		type: String,
		index: true
	},
	sortType: {
		type: String
	},
	sortOption: {
		groupBy: {
			type: String
		},
		orderBy: {
			type: String
		}
	},
	teamId: {
		type: String
	},
	timeline: {
		range: {
			type: String
		},
		sortType: {
			type: String
		},
		sortOption: {
			groupBy: {
				type: String
			},
			orderBy: {
				type: String
			}
		}
	}
}, {
	collection: 'projects',
	discriminatorKey: 'source',
	timestamps: false
});

// Create base model
const Project = mongoose.model('Project', BaseProjectSchema);

// TickTick-specific schema (discriminator for TickTick projects)
const TickTickProjectSchema = new Schema({
	isOwner: {
		type: Boolean,
		default: false
	},
	userCount: {
		type: Number
	},
	etag: {
		type: String
	},
	modifiedTime: {
		type: Date,
		index: true
	},
	inAll: {
		type: Boolean,
		default: false
	},
	showType: {
		type: Number
	},
	muted: {
		type: Boolean,
		default: false
	},
	reminderType: {
		type: Number
	},
	transferred: {
		type: String
	},
	notificationOptions: {
		type: [Schema.Types.Mixed],
		default: []
	},
	permission: {
		type: String
	},
	kind: {
		type: String
	},
	needAudit: {
		type: Boolean,
		default: false
	},
	barcodeNeedAudit: {
		type: Boolean,
		default: false
	},
	openToTeam: {
		type: Boolean
	},
	teamMemberPermission: {
		type: String
	}
});

// Todoist-specific schema (discriminator for Todoist projects)
const TodoistProjectSchema = new Schema({
	description: {
		type: String,
		default: ''
	},
	order: {
		type: Number
	},
	isCollapsed: {
		type: Boolean,
		default: false
	},
	isShared: {
		type: Boolean,
		default: false
	},
	isFavorite: {
		type: Boolean,
		default: false,
		index: true
	},
	isArchived: {
		type: Boolean,
		default: false,
		index: true
	},
	canAssignTasks: {
		type: Boolean,
		default: false
	},
	viewStyle: {
		type: String
	},
	isInboxProject: {
		type: Boolean,
		default: false,
		index: true
	},
	workspaceId: {
		type: String
	},
	folderId: {
		type: String
	},
	createdAt: {
		type: Date,
		index: true
	},
	updatedAt: {
		type: Date,
		index: true
	}
});

// Session-specific schema (discriminator for Session projects/categories)
const SessionProjectSchema = new Schema({
	// Session categories map entirely to base schema fields
	// No additional fields needed
});

const ProjectTickTick = Project.discriminator('ProjectTickTick', TickTickProjectSchema);
const ProjectTodoist = Project.discriminator('ProjectTodoist', TodoistProjectSchema);
const ProjectSession = Project.discriminator('ProjectSession', SessionProjectSchema);

export { Project, ProjectTickTick, ProjectTodoist, ProjectSession };
export default Project;
