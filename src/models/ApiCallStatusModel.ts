import mongoose, { Document, Schema } from 'mongoose';
import { applyUserIdEnforcement } from '../utils/schema.utils';

interface IApiCallStatus extends Document {
	userId: mongoose.Types.ObjectId;
	apiEndpoint: string;
	isInProgress: boolean;
	startedAt: Date;
}

const apiCallStatusSchema = new Schema<IApiCallStatus>({
	userId: {
		type: Schema.Types.ObjectId,
		ref: 'User',
		required: true,
	},
	apiEndpoint: {
		type: String,
		required: true,
	},
	isInProgress: {
		type: Boolean,
		required: true,
		default: false,
	},
	startedAt: {
		type: Date,
		required: true,
	},
}, {
	collection: 'apiCallStatuses'
});

// Compound unique index to ensure one status per user per endpoint
apiCallStatusSchema.index({ userId: 1, apiEndpoint: 1 }, { unique: true });

// Apply userId enforcement middleware
applyUserIdEnforcement(apiCallStatusSchema);

const ApiCallStatus = mongoose.model<IApiCallStatus>('ApiCallStatus', apiCallStatusSchema);

export default ApiCallStatus;
