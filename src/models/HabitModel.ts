import mongoose, { Schema } from 'mongoose';
import { HabitDocument } from '../interfaces/Habit';

// Define a sub-schema for days of the week
const DaySchema = new Schema({
	fullName: { type: String, required: true },
	shortName: { type: String, required: true },
	selected: { type: Boolean, default: true },
});

// Predefined days of the week as a function to return a fresh array each time
function defaultDaysOfWeek() {
	return [
		{ fullName: 'Monday', shortName: 'Mon', selected: true },
		{ fullName: 'Tuesday', shortName: 'Tue', selected: true },
		{ fullName: 'Wednesday', shortName: 'Wed', selected: true },
		{ fullName: 'Thursday', shortName: 'Thu', selected: true },
		{ fullName: 'Friday', shortName: 'Fri', selected: true },
		{ fullName: 'Saturday', shortName: 'Sat', selected: true },
		{ fullName: 'Sunday', shortName: 'Sun', selected: true },
	];
}
interface ValidationProps {
	value: string | Date | boolean | null; // includes string to handle date strings
}

const CheckedInDaySchema = new Schema({
	isAchieved: {
		type: Schema.Types.Mixed, // Allows any type, but will validate for specific ones
		default: null,
		validate: {
			validator: function (v: Date | false | null): boolean {
				// Check if v is null, false, a Date object, or a valid date string
				return (
					v === null || v === false || v instanceof Date || (!isNaN(Date.parse(v)) && typeof v === 'string')
				);
			},
			message: (props: ValidationProps) => `${props.value} is not a valid value for isAchieved!`,
		},
	},
	habitLogId: { type: Schema.Types.ObjectId, ref: 'HabitLog', default: null },
});

const HabitSchema = new Schema(
	{
		name: {
			type: String,
			required: true,
		},
		frequency: {
			daily: {
				selected: { type: Boolean },
				daysOfWeek: { type: [DaySchema], default: defaultDaysOfWeek }, // Use function to set default
			},
			weekly: {
				selected: { type: Boolean },
				daysPerWeek: Number,
			},
			interval: {
				selected: { type: Boolean },
				everyXDays: { type: Number },
			},
		},
		goal: {
			achieveItAll: {
				selected: { type: Boolean },
			},
			reachCertainAmount: {
				selected: { type: Boolean },
				dailyValue: { type: Number },
				dailyUnit: { type: String },
				whenChecking: { type: String },
			},
		},
		startDate: { type: Date },
		goalDays: {
			type: Number,
		},
		habitSectionId: {
			type: Schema.Types.ObjectId,
			ref: 'HabitSection',
			default: null,
		},
		reminders: [{ type: Date }],
		isArchived: { type: Date || null, default: null },
		icon: { type: String },
		checkedInDays: { type: Map, of: CheckedInDaySchema, default: () => new Map() },
	},
	{
		timestamps: true,
	}
);

const Habit = mongoose.model<HabitDocument>('Habit', HabitSchema);

export default Habit;
