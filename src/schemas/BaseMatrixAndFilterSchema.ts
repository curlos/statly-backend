import { Schema, Document } from 'mongoose';
import { IDateOption, DateOptionSchema } from './DateOptionSchema';
import { PrioritySchema } from './PrioritySchema';

export interface IBaseMatrixAndFilterSchema extends Document {
	name: string;
	selectedProjectIds: Schema.Types.ObjectId[];
	selectedTagIds: Schema.Types.ObjectId[];
	selectedDates: {
		fromDate: Date | null;
		toDate: Date | null;
	};
	selectedPriorities: {
		high: boolean;
		medium: boolean;
		low: boolean;
		none: boolean;
	};
	dateOptions: {
		all: IDateOption;
		noDate: IDateOption;
		overdue: IDateOption;
		repeat: IDateOption;
		today: IDateOption;
		tomorrow: IDateOption;
		thisWeek: IDateOption;
		nextWeek: IDateOption;
		thisMonth: IDateOption;
		nextMonth: IDateOption;
		duration: IDateOption;
	};
	order: Number;
	createdAt?: Date;
	updatedAt?: Date;
}

const BaseMatrixAndFilterSchema: Schema = new Schema(
	{
		name: { type: String, required: true },
		selectedProjectIds: [{ type: Schema.Types.ObjectId, ref: 'Project' }],
		selectedTagIds: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
		selectedPriorities: {
			type: PrioritySchema,
			default: () => ({}), // This will automatically apply PrioritySchema defaults
		},
		dateOptions: {
			type: {
				all: DateOptionSchema,
				noDate: DateOptionSchema,
				overdue: DateOptionSchema,
				repeat: DateOptionSchema,
				today: DateOptionSchema,
				tomorrow: DateOptionSchema,
				thisWeek: DateOptionSchema,
				nextWeek: DateOptionSchema,
				thisMonth: DateOptionSchema,
				nextMonth: DateOptionSchema,
				duration: DateOptionSchema,
			},
			default: () => ({
				all: { name: 'All', iconName: 'stacks', selected: true },
				noDate: { name: 'No Date', iconName: 'hourglass_empty', selected: false },
				overdue: { name: 'Overdue', iconName: 'west', selected: false },
				repeat: { name: 'Repeat', iconName: 'repeat', selected: false },
				today: { name: 'Today', iconName: 'calendar_today', selected: false },
				tomorrow: { name: 'Tomorrow', iconName: 'upcoming', selected: false },
				thisWeek: { name: 'This Week', iconName: 'event_upcoming', selected: false },
				nextWeek: { name: 'Next Week', iconName: 'stacks', selected: false },
				thisMonth: { name: 'This Month', iconName: 'dark_mode', selected: false },
				nextMonth: { name: 'Next Month', iconName: 'nights_stay', selected: false },
				duration: { name: 'Duration', iconName: 'timer', selected: false, fromDate: null, toDate: null },
			}),
			_id: false,
		},
		groupBy: { type: String, required: true, default: 'priority' },
		sortBy: { type: String, required: true, default: 'priority' },
		order: { type: Number },
	},
	{
		timestamps: true,
	}
);

export default BaseMatrixAndFilterSchema;
