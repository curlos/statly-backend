import { Schema } from 'mongoose';

export const PrioritySchema = new Schema(
	{
		high: { type: Boolean, default: false },
		medium: { type: Boolean, default: false },
		low: { type: Boolean, default: false },
		none: { type: Boolean, default: false },
	},
	{ _id: false }
); // Correctly placing _id: false
