import mongoose, { Schema, Document } from 'mongoose';

interface IHabitSection {}

const HabitSectionSchema = new Schema(
	{
		name: {
			type: String,
			required: true,
		},
		habitIds: [{ type: Schema.Types.ObjectId, ref: 'HabitSection', default: null }],
	},
	{
		timestamps: true,
	}
);

const HabitSection = mongoose.model<IHabitSection>('HabitSection', HabitSectionSchema, 'habit-sections');

export default HabitSection;
