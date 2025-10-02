import { Schema } from 'mongoose';

export const DateOptionSchema = new Schema(
	{
		name: { type: String, required: true },
		iconName: { type: String, required: true },
		selected: { type: Boolean, required: true, default: false },
		fromDate: { type: Date, default: null },
		toDate: { type: Date, default: null },
	},
	{ _id: false }
); // Disable _id for sub-document if not necessary

export interface IDateOption {
	name: string;
	iconName: string;
	selected: boolean;
	fromDate?: Date | null;
	toDate?: Date | null;
}
