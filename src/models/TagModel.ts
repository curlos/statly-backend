import mongoose, { Schema, Document } from 'mongoose';

interface ITag extends Document {
	name: string;
	color?: string;
	children?: Schema.Types.ObjectId[] | [];
	sortOrder?: number;
	sortOption?: {
		groupBy: string;
		orderBy: string;
	};
	sortType?: string;
}

const TagSchema = new Schema(
	{
		name: {
			type: String,
			required: true,
		},
		color: {
			type: String,
			default: null,
		},
		children: [{ type: Schema.Types.ObjectId, ref: 'Tag', required: true, default: [] }],
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
	},
	{
		timestamps: true,
	}
);

const Tag = mongoose.model<ITag>('Tag', TagSchema, 'tags');

export default Tag;
