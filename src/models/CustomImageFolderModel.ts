import mongoose, { Schema, Document, Types } from 'mongoose';
import { applyUserIdEnforcement } from '../utils/schema.utils';

// TypeScript Interface
export interface ICustomImageFolder extends Document {
	userId: Types.ObjectId;
	name: string;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date;
}

// Schema definition
const CustomImageFolderSchema = new Schema({
	userId: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true,
		index: true
	},
	name: {
		type: String,
		required: true,
		uppercase: true, // Automatically convert to uppercase
		trim: true,
		maxlength: 50
	},
	sortOrder: {
		type: Number,
		default: 0,
		index: true
	},
}, {
	timestamps: true, // Automatically adds createdAt and updatedAt
	collection: 'customImageFolders'
});

// Add compound unique index to prevent duplicate folder names per user
CustomImageFolderSchema.index({ userId: 1, name: 1 }, { unique: true });

// Add compound index for efficient retrieval (userId first, ordered by sortOrder then creation time)
CustomImageFolderSchema.index({ userId: 1, sortOrder: 1, createdAt: -1 });

// Apply userId enforcement middleware for security
applyUserIdEnforcement(CustomImageFolderSchema);

// Create and export model
const CustomImageFolder = mongoose.model<ICustomImageFolder>('CustomImageFolder', CustomImageFolderSchema);

export default CustomImageFolder;
