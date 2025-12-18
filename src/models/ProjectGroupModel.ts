import mongoose, { Schema, Document, Types } from 'mongoose';
import { applyUserIdEnforcement } from '../utils/schema.utils';

// TypeScript Interface
export interface IProjectGroup extends Document {
	id: string;
	userId: Types.ObjectId;
	source: string;
	name: string;
	etag?: string;
	showAll?: boolean;
	sortOrder?: number;
	viewMode?: string;
	deleted?: number;
	sortType?: string;
	sortOption?: {
		groupBy?: string;
		orderBy?: string;
	};
	teamId?: string;
	timeline?: {
		range?: string;
		sortType?: string;
		sortOption?: {
			groupBy?: string;
			orderBy?: string;
		};
	};
}

// TickTick Project Group Schema
const ProjectGroupTickTickSchema = new Schema({
	id: {
		type: String,
		required: true,
		index: true
	},
	source: {
		type: String,
		required: true,
		default: 'ProjectGroupTickTick'
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
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true,
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
	collection: 'projectGroups',
	timestamps: false
});

// Add compound unique index to ensure id is unique per user (not globally unique)
ProjectGroupTickTickSchema.index({ id: 1, userId: 1 }, { unique: true });

// Apply userId enforcement middleware
applyUserIdEnforcement(ProjectGroupTickTickSchema);

const ProjectGroupTickTick = mongoose.model('ProjectGroupTickTick', ProjectGroupTickTickSchema);

export { ProjectGroupTickTick };
export default ProjectGroupTickTick;
