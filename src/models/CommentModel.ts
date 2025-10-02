import mongoose, { Schema, Document } from 'mongoose';
interface IComment extends Document {
	task: mongoose.Types.ObjectId[];
	author: string;
	content: string;
}

const commentSchema = new Schema(
	{
		taskId: {
			type: Schema.Types.ObjectId,
			ref: 'Task',
			required: true,
		},
		authorId: {
			type: Schema.Types.ObjectId,
			ref: 'User',
			required: true,
		},
		content: {
			type: String,
			required: true,
		},
	},
	{
		timestamps: true,
	}
);

commentSchema.index({ task: 1, author: 1, createdAt: -1 });

const Comment = mongoose.model<IComment>('Comment', commentSchema);

export default Comment;
