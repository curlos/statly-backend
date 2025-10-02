import mongoose, { Schema } from 'mongoose';

interface IHabitSection {}

const HabitLogSchema = new Schema(
	{
		content: {
			type: String,
			required: true,
		},
		habitId: {
			type: Schema.Types.ObjectId,
			ref: 'Habit',
			required: true,
		},
		checkedInDayKey: {
			type: String,
			required: true,
		},
	},
	{
		timestamps: true,
	}
);

const HabitLog = mongoose.model<IHabitSection>('HabitLog', HabitLogSchema, 'habit-logs');

export default HabitLog;
