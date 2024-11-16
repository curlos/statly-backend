import mongoose, { Schema, Document } from 'mongoose';

interface IUserSettings extends Document {
	habit: Object;
}

const UserSettingsSchema = new Schema(
	{
		userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
		habit: {
			showInTimedSmartLists: { type: Boolean, default: true },
		},
		calendarViewOptions: {
			colorsType: { type: String, default: 'Projects' },
			shownTasksFilters: {
				showCompleted: { type: Boolean, default: true },
				showCheckItem: { type: Boolean, default: true },
				showAllRepeatCycle: { type: Boolean, default: true },
				showHabit: { type: Boolean, default: true },
				showFocusRecords: { type: Boolean, default: true },
				showWeekends: { type: Boolean, default: true },
			},
		},
		theme: {
			color: { type: String },
		},
		tickTickOne: {
			pages: {
				focusRecords: {
					showCompletedTasks: { type: Boolean },
					showFocusNotes: { type: Boolean },
					showTotalFocusDuration: { type: Boolean },
				},
			},
		},
	},
	{
		timestamps: true,
	}
);

const UserSettings = mongoose.model<IUserSettings>('UserSettings', UserSettingsSchema, 'user-settings');

export default UserSettings;
