import mongoose, { Document, Schema } from 'mongoose';

interface ISyncMetadata extends Document {
	userId: mongoose.Types.ObjectId;
	syncType: string;
	lastSyncTime: Date;
	tasksUpdated?: number;
}

const syncMetadataSchema = new Schema<ISyncMetadata>({
	userId: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true,
	},
	syncType: {
		type: String,
		required: true,
	},
	lastSyncTime: {
		type: Date,
		required: true,
	},
	tasksUpdated: {
		type: Number,
	},
}, {
	collection: 'syncMetaDatas'
});

// Compound index for efficient queries
syncMetadataSchema.index({ userId: 1, syncType: 1 }, { unique: true });

const SyncMetadata = mongoose.model<ISyncMetadata>('SyncMetadata', syncMetadataSchema);

export default SyncMetadata;
