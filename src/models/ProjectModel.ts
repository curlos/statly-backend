import mongoose, { Schema, Document } from 'mongoose';

interface IProject extends Document {
	name: string;
	color?: string;
	sortOrder?: number;
	sortOption?: {
		groupBy: string;
		orderBy: string;
	};
	sortType?: string;
	groupId?: Schema.Types.ObjectId | null;
	isFolder?: boolean;
	isInbox?: boolean;
}

const ProjectSchema = new Schema(
	{
		name: {
			type: String,
			required: true,
		},
		color: {
			type: String,
			default: null,
		},
		sortOrder: {
			type: Number,
			default: 0,
		},
		sortOption: {
			groupBy: {
				type: String,
				default: 'none',
			},
			orderBy: {
				type: String,
				default: 'name',
			},
		},
		sortType: {
			type: String,
			enum: ['default', 'ascending', 'descending'],
			default: 'default',
		},
		groupId: {
			type: Schema.Types.ObjectId,
			ref: 'Project',
			default: null,
		},
		isFolder: {
			type: Boolean,
			default: false,
		},
		isInbox: {
			type: Boolean,
			default: false,
			immutable: true,
		},
	},
	{
		timestamps: true,
	}
);

const Project = mongoose.model<IProject>('Project', ProjectSchema, 'projects');

export default Project;
