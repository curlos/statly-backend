import mongoose, { Schema, Document, Types } from 'mongoose';
import { applyUserIdEnforcement } from '../utils/schema.utils';

// TypeScript Interface
export interface ICustomImage extends Document {
	userId: Types.ObjectId;
	imageUrl: string;
	cloudinaryPublicId: string;
	folder: string;
	sortOrder: number;
	createdAt: Date;
	updatedAt: Date;
}

// Schema definition
const CustomImageSchema = new Schema({
	userId: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true,
		index: true
	},
	imageUrl: {
		type: String,
		required: true,
	},
	cloudinaryPublicId: {
		type: String,
		required: true,
	},
	folder: {
		type: String,
		default: 'GENERAL',
		uppercase: true,
		trim: true,
		required: true,
		index: true
	},
	sortOrder: {
		type: Number,
		default: 0,
		index: true
	},
}, {
	timestamps: true, // Automatically adds createdAt and updatedAt
	collection: 'customImages'
});

// Add compound index for efficient retrieval by folder (userId + folder, ordered by sortOrder then creation time)
CustomImageSchema.index({ userId: 1, folder: 1, sortOrder: 1, createdAt: -1 });

// Apply userId enforcement middleware for security
applyUserIdEnforcement(CustomImageSchema);

// Create and export model
const CustomImage = mongoose.model<ICustomImage>('CustomImage', CustomImageSchema);

export default CustomImage;
