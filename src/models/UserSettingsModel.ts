import mongoose, { Schema, Document } from 'mongoose';
import { applyUserIdEnforcement } from '../utils/schema.utils';

interface IUserSettings extends Document {
	theme?: {
		color?: string;
		fontFamily?: string;
	};
	tickTickCookie?: string;
	autoSyncEnabled?: boolean;
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
				showFocusRecordEmotions?: boolean;
				showEmotionCount?: boolean;
				analyzeNoteEmotionsWhileSyncingFocusRecords?: boolean;
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
				rings?: Array<{
					id: string;
					name: string;
					color: string | null;
					useThemeColor?: boolean;
					isActive: boolean;
					projects?: Record<string, any>;
					goalSeconds?: number;
					showStreakCount?: boolean;
					goalDays?: number;
					showGoalDays?: boolean;
					selectedDaysOfWeek?: {
						monday?: boolean;
						tuesday?: boolean;
						wednesday?: boolean;
						thursday?: boolean;
						friday?: boolean;
						saturday?: boolean;
						sunday?: boolean;
					};
					restDays?: Record<string, boolean>;
					customDailyFocusGoal?: Record<string, number>;
					inactivePeriods?: Array<{
						startDate: string;
						endDate: string | null;
					}>;
					createdAt: string;
					updatedAt: string;
				}>;
				showMultiRingViewForOneActiveRing?: boolean;
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
		theme: {
			color: { type: String, default: 'blue-500' },
			fontFamily: { type: String, default: 'Default' }
		},
		tickTickCookie: { type: String, default: '' },
		autoSyncEnabled: { type: Boolean, default: false },
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
					maxFocusRecordsPerPage: { type: Number, default: 25 },
					onlyExportTasksWithNoParent: { type: Boolean, default: true },
					showMedals: { type: Boolean, default: false },
					selectedMedalImage: { type: String, default: "https://res.cloudinary.com/dvsuz3v37/image/upload/v1762007663/Statly/battlefield-1-medals/weapons/28_5HFD732.webp" },
					medalImageSizePx: { type: Number, default: 100 },
					showMedalGlow: { type: Boolean, default: false },
					showFocusRecordEmotions: { type: Boolean, default: false },
					showEmotionCount: { type: Boolean, default: false },
					analyzeNoteEmotionsWhileSyncingFocusRecords: { type: Boolean, default: false }
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
					rings: {
						type: [
							{
								id: { type: String, required: true },
								name: { type: String, required: true },
								color: { type: String, default: null },
								useThemeColor: { type: Boolean, default: false },
								isActive: { type: Boolean, required: true },
								projects: { type: Object, default: {} },
								goalSeconds: { type: Number, default: 3600 },
								showStreakCount: { type: Boolean, default: true },
								goalDays: { type: Number, default: 7 },
								showGoalDays: { type: Boolean, default: true },
								selectedDaysOfWeek: {
									monday: { type: Boolean, default: true },
									tuesday: { type: Boolean, default: true },
									wednesday: { type: Boolean, default: true },
									thursday: { type: Boolean, default: true },
									friday: { type: Boolean, default: true },
									saturday: { type: Boolean, default: true },
									sunday: { type: Boolean, default: true }
								},
								restDays: { type: Object, default: {} },
								customDailyFocusGoal: { type: Object, default: {} },
								inactivePeriods: {
									type: [
										{
											startDate: { type: String, required: true },
											endDate: { type: String, default: null }
										}
									],
									default: []
								},
								createdAt: { type: String, required: true },
								updatedAt: { type: String, required: true }
							}
						],
						default: []
					},
					showMultiRingViewForOneActiveRing: { type: Boolean, default: false }
				},
				challenges: {
					selectedChallengeCardImage: {
						focus: { type: String, default: "https://res.cloudinary.com/dvsuz3v37/image/upload/v1762007839/Statly/black-ops-2-calling-cards/general/432_6xLKg5k.webp" },
						tasks: { type: String, default: "https://res.cloudinary.com/dvsuz3v37/image/upload/v1762007840/Statly/black-ops-2-calling-cards/general/436_x084PtQ.webp" },
					}
				},
				medals: {
					selectedMedalCardImage: {
						focus: { type: String, default: "https://res.cloudinary.com/dvsuz3v37/image/upload/v1762007663/Statly/battlefield-1-medals/weapons/28_5HFD732.webp" },
						tasks: { type: String, default: "https://res.cloudinary.com/dvsuz3v37/image/upload/v1762007766/Statly/battlefield-1-medals/combat/56_91AMzBS.webp" },
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

// Apply userId enforcement middleware
applyUserIdEnforcement(UserSettingsSchema);

const UserSettings = mongoose.model<IUserSettings>('UserSettings', UserSettingsSchema, 'user-settings');

export default UserSettings;
