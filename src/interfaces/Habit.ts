import { ObjectId } from 'mongodb';
import mongoose, { Schema, Types } from 'mongoose';

interface DailyFrequency {
	selected: boolean;
	selectedDays: string[];
}

interface WeeklyFrequency {
	selected: boolean;
	daysPerWeek: number;
}

interface IntervalFrequency {
	selected: boolean;
	everyXDays: number;
}

interface AchieveItAllGoal {
	selected: boolean;
}

interface ReachCertainAmountGoal {
	selected: boolean;
	dailyValue: number;
	dailyUnit: string;
	whenChecking: string;
}

interface Day {
	fullName: string;
	shortName: string;
	selected: boolean;
}

interface CheckedInDay {
	isAchieved: Date | false | null;
	habitLogId: mongoose.Types.ObjectId | null;
}

export interface HabitDocument extends mongoose.Document {
	_id: Schema.Types.ObjectId;
	name: string;
	frequency: {
		daily: {
			selected: boolean;
			daysOfWeek: Day[];
		};
		weekly: {
			selected: boolean;
			daysPerWeek: number;
		};
		interval: {
			selected: boolean;
			everyXDays: number;
		};
	};
	goal: {
		achieveItAll: {
			selected: boolean;
		};
		reachCertainAmount: {
			selected: boolean;
			dailyValue: number;
			dailyUnit: string;
			whenChecking: string;
		};
	};
	startDate: Date;
	goalDays: number;
	habitSectionId: mongoose.Types.ObjectId | null;
	reminders: Date[];
	isArchived: Date | null;
	icon: string;
	checkedInDays: Map<string, CheckedInDay>;
}
