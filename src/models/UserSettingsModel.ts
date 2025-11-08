import mongoose, { Schema, Document } from 'mongoose';

interface IUserSettings extends Document {
	habit?: {
		showInTimedSmartLists?: boolean;
	};
	calendarViewOptions?: {
		colorsType?: string;
		shownTasksFilters?: {
			showCompleted?: boolean;
			showCheckItem?: boolean;
			showAllRepeatCycle?: boolean;
			showHabit?: boolean;
			showFocusRecords?: boolean;
			showWeekends?: boolean;
		};
	};
	theme?: {
		color?: string;
		fontFamily?: string;
	};
	tickTickOne?: {
		pages?: {
			focusRecords?: {
				showFocusNotes?: boolean;
				showTotalFocusDuration?: boolean;
				showCompletedTasks?: boolean;
				showTaskAncestors?: boolean;
				showTaskProjectName?: boolean;
				taskIdIncludeFocusRecordsFromSubtasks?: boolean;
				filterOutUnrelatedTasksWhenTaskIdIsApplied?: boolean;
				maxFocusRecordsPerPage?: number;
				onlyExportTasksWithNoParent?: boolean;
				showMedals?: boolean;
				selectedMedalImage?: string;
				medalImageSizePx?: number;
				showMedalGlow?: boolean;
			};
			completedTasks?: {
				taskIdIncludeCompletedTasksFromSubtasks?: boolean;
				filterOutUnrelatedTasksWhenTaskIdIsApplied?: boolean;
				groupedTasksCollapsedByDefault?: boolean;
				showIndentedTasks?: boolean;
				onlyExportTasksWithNoParent?: boolean;
				maxDaysPerPage?: number;
			};
			focusHoursGoal?: {
				projects?: Record<string, any>;
			};
			challenges?: {
				selectedChallengeCardImage?: {
					focus?: string;
					tasks?: string;
				};
			};
			medals?: {
				selectedMedalCardImage?: {
					focus?: string;
					tasks?: string;
				};
				defaultMedalInterval?: string;
				customMedalStartDate?: string;
			};
		};
	};
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
			fontFamily: { type: String, default: 'Default' }
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
					showMedals: { type: Boolean, default: true },
					selectedMedalImage: { type: String, default: "https://i.imgur.com/6xLKg5k.jpeg" },
					medalImageSizePx: { type: Number, default: 100 },
					showMedalGlow: { type: Boolean, default: false }
				},
				completedTasks: {
					taskIdIncludeCompletedTasksFromSubtasks: { type: Boolean, default: true },
					filterOutUnrelatedTasksWhenTaskIdIsApplied: { type: Boolean, default: true },
					groupedTasksCollapsedByDefault: { type: Boolean, default: true },
					showIndentedTasks: { type: Boolean, default: true },
					onlyExportTasksWithNoParent: { type: Boolean, default: true },
					maxDaysPerPage: { type: Number, default: 7 }
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
					},
					defaultMedalInterval: { type: String, default: "All" },
					customMedalStartDate: { type: String, default: "" }
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
