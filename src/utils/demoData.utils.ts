import mongoose, { ClientSession, Types } from 'mongoose';
import type { Collection } from 'mongodb';
import { formatInTimeZone } from 'date-fns-tz';
import FocusRecord from '../models/FocusRecord';
import Task from '../models/TaskModel';
import User from '../models/UserModel';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const FOCUS_RECORD_DATE_FIELDS = ['startTime', 'endTime'];
const TASK_DATE_FIELDS = ['completedTime', 'createdTime', 'modifiedTime', 'startDate'];

// Moves a date by the given time, leaving an empty date empty.
const shiftedDate = (fieldPath: string, ms: number) => ({
	$cond: [{ $gt: [fieldPath, null] }, { $add: [fieldPath, ms] }, fieldPath],
});

const shiftedFields = (fields: string[], ms: number) =>
	Object.fromEntries(fields.map((field) => [field, shiftedDate(`$${field}`, ms)]));

// Guests share one set of data, so "today" for the demo is today in this time zone
const DEMO_TIME_ZONE = 'America/New_York';

// The calendar day a moment falls on in the demo's time zone, as midnight UTC of that date
const demoDay = (date: Date) => new Date(formatInTimeZone(date, DEMO_TIME_ZONE, 'yyyy-MM-dd')).getTime();

// How many whole days the demo data needs to move so its newest day of focus records is today, even if some of today's records start later in the day.
export const getDemoDaysToShift = (originalNewestFocusAt: Date, daysAlreadyShifted: number, now: Date) => {
	const daysBehind = Math.round((demoDay(now) - demoDay(originalNewestFocusAt)) / MS_PER_DAY);
	return Math.max(daysBehind - daysAlreadyShifted, 0);
};

// Moves every date of a user's focus records and tasks. A negative number of days moves them back. Pass a session to make it part of a transaction.
export const shiftUserDates = async (userId: Types.ObjectId, days: number, session?: ClientSession) => {
	const ms = days * MS_PER_DAY;

	// The native collection is used since Mongoose would try to cast these date expressions to dates.
	await FocusRecord.collection.updateMany(
		{ userId },
		[
			{
				$set: {
					...shiftedFields(FOCUS_RECORD_DATE_FIELDS, ms),
					tasks: {
						$map: {
							input: { $ifNull: ['$tasks', []] },
							as: 'task',
							in: {
								$mergeObjects: [
									'$$task',
									{
										startTime: shiftedDate('$$task.startTime', ms),
										endTime: shiftedDate('$$task.endTime', ms),
									},
								],
							},
						},
					},
				},
			},
		],
		{ session }
	);

	await Task.collection.updateMany({ userId }, [{ $set: shiftedFields(TASK_DATE_FIELDS, ms) }], { session });
};

interface DemoUser {
	_id: unknown;
	isDemo?: boolean;
	demoOriginalNewestFocusAt?: Date;
	demoDaysShifted?: number;
}

// Keeps the demo account looking recent. The days are worked out from saved values rather than the records so that two guests arriving at once can't both shift the dates. The count of shifted days and all the dates change in one transaction, so either everything moves or nothing does and the next visitor tries again. Returns false if it couldn't.
export const shiftDemoDataIfStale = async (user: DemoUser) => {
	if (!user.isDemo || !user.demoOriginalNewestFocusAt) {
		return true;
	}

	const daysShifted = user.demoDaysShifted ?? 0;
	const days = getDemoDaysToShift(user.demoOriginalNewestFocusAt, daysShifted, new Date());

	if (days === 0) {
		return true;
	}

	const session = await mongoose.startSession();

	try {
		// Another guest or a restore that got there first makes this one's claim fail to match, and then there's nothing left to do
		await session.withTransaction(async () => {
			const claim = await User.updateOne(
				{ _id: user._id, isDemo: true, demoDaysShifted: daysShifted },
				{ $inc: { demoDaysShifted: days } },
				{ session }
			);

			if (claim.modifiedCount === 0) {
				return;
			}

			await shiftUserDates(user._id as Types.ObjectId, days, session);
		});
		return true;
	} catch (error) {
		console.error('Failed to shift demo data:', error);
		return false;
	} finally {
		await session.endSession();
	}
};

// Puts the demo account's dates back to the originals and turns the demo off so guests don't shift them again. It's one transaction that writes to the same user a shift does, so a shift that's in progress can't overlap it: one of them waits for the other. Returns how many days were moved back.
export const restoreDemoDates = async (email: string) => {
	const session = await mongoose.startSession();
	let days = 0;

	try {
		await session.withTransaction(async () => {
			const user = await User.findOneAndUpdate({ email }, { $set: { isDemo: false } }, { session, new: true });
			if (!user) {
				throw new Error(`No user found with the email ${email}`);
			}

			days = user.demoDaysShifted ?? 0;
			await shiftUserDates(user._id as Types.ObjectId, -days, session);
			await User.updateOne({ _id: user._id }, { $set: { demoDaysShifted: 0 } }, { session });
		});
		return days;
	} finally {
		await session.endSession();
	}
};

// Copies a user's documents from one collection to another without ever leaving the target empty or half replaced. The new documents go in first, replacing any with the same _id, and only then are documents that aren't in the source any more removed. If it fails partway the target still has everything it had and running it again finishes the job.
export const replaceUserDocuments = async (source: Collection, target: Collection, userId: Types.ObjectId) => {
	const documents = await source.find({ userId }).toArray();

	if (documents.length > 0) {
		await target.bulkWrite(
			documents.map((document) => ({
				replaceOne: { filter: { _id: document._id }, replacement: document, upsert: true },
			}))
		);
	}

	await target.deleteMany({ userId, _id: { $nin: documents.map((document) => document._id) } });

	return documents.length;
};

// The demo account's settings get copied as they are, so a saved TickTick cookie would be copied to a shared, public account along with them. The setup script clears it, and this makes sure that happened.
export const assertNoSavedCookie = async (userSettings: Collection, userId: Types.ObjectId) => {
	const settings = await userSettings.findOne({ userId });

	if (settings?.tickTickCookie) {
		throw new Error(
			'The demo account still has a TickTick cookie saved. Run setupDemoAccount.ts to clear it. Nothing was copied.'
		);
	}
};
