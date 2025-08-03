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
			fontFamily: { type: String, default: 'Default' },
			loaderCardImage: { type: String }
		},
		tickTickOne: {
			pages: {
				focusRecords: {
					showFocusNotes: { type: Boolean, default: true },
					showTotalFocusDuration: { type: Boolean, default: true },
					showCompletedTasks: { type: Boolean, default: true },
					showTaskAncestors: { type: Boolean, default: true },
					showTaskProjectName: { type: Boolean, default: true },
					taskIdIncludeFocusRecordsFromSubtasks: { type: Boolean, default: true },
					filterOutUnrelatedTasksWhenTaskIdIsApplied: { type: Boolean, default: true },
					maxFocusRecordsPerPage: { type: Number, default: 50 },
					onlyExportTasksWithNoParent: { type: Boolean, default: true },
				},
				completedTasks: {
					taskIdIncludeCompletedTasksFromSubtasks: { type: Boolean, default: true },
					filterOutUnrelatedTasksWhenTaskIdIsApplied: { type: Boolean, default: true },
					groupedTasksCollapsedByDefault: { type: Boolean, default: true },
					showIndentedTasks: { type: Boolean, default: true },
					onlyExportTasksWithNoParent: { type: Boolean, default: true },
					maxDaysPerPage: { type: Number, default: 7 },
				},
				focusHoursGoal: {
					projects: { type: Object, default: {} }
				},
				challenges: {
					selectedChallengeCardImage: {
						focus: { type: String, default: "https://i.imgur.com/6xLKg5k.jpeg" },
						tasks: { type: String, default: "https://i.imgur.com/x084PtQ.png" },
					}
				},
				medals: {
					selectedMedalCardImage: {
						focus: { type: String, default: "https://i.imgur.com/dIvJYlX.png" },
						tasks: { type: String, default: "https://i.imgur.com/91AMzBS.png" },
					}
				}
			},
		},
	},
	{
		timestamps: true,
	}
);

const UserSettings = mongoose.model<IUserSettings>('UserSettings', UserSettingsSchema, 'user-settings');

export default UserSettings;
