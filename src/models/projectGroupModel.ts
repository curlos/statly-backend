import mongoose, { Schema } from 'mongoose';

// TickTick Project Group Schema
const ProjectGroupTickTickSchema = new Schema({
	id: {
		type: String,
		required: true,
		unique: true,
		index: true
	},
	etag: {
		type: String
	},
	name: {
		type: String,
		required: true
	},
	showAll: {
		type: Boolean,
		default: false
	},
	sortOrder: {
		type: Number
	},
	viewMode: {
		type: String
	},
	deleted: {
		type: Number,
		default: 0
	},
	userId: {
		type: Number
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
	collection: 'project_groups',
	timestamps: false
});

const ProjectGroupTickTick = mongoose.model('ProjectGroupTickTick', ProjectGroupTickTickSchema);

export { ProjectGroupTickTick };
export default ProjectGroupTickTick;
