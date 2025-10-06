import mongoose, { Schema } from 'mongoose';

// TickTick Project Schema
const ProjectTickTickSchema = new Schema({
	id: {
		type: String,
		required: true,
		unique: true,
		index: true
	},
	name: {
		type: String,
		required: true
	},
	isOwner: {
		type: Boolean,
		default: false
	},
	color: {
		type: String
	},
	sortOrder: {
		type: Number
	},
	sortOption: {
		groupBy: {
			type: String
		},
		orderBy: {
			type: String
		}
	},
	sortType: {
		type: String
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
	closed: {
		type: Boolean
	},
	transferred: {
		type: String
	},
	groupId: {
		type: String
	},
	viewMode: {
		type: String
	},
	notificationOptions: {
		type: [Schema.Types.Mixed],
		default: []
	},
	teamId: {
		type: String
	},
	permission: {
		type: String
	},
	kind: {
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
	},
	source: {
		type: Number
	}
}, {
	collection: 'projects',
	timestamps: false
});

const ProjectTickTick = mongoose.model('ProjectTickTick', ProjectTickTickSchema);

export { ProjectTickTick };
export default ProjectTickTick;
