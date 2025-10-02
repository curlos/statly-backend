import mongoose from 'mongoose';
import HabitLog from '../models/HabitLog';
import connectDB from './database';
import Habit from '../models/HabitModel';

const removeAllOldHabitLogs = async () => {
	try {
		await connectDB();

		// Delete all Habit Logs from the DB and get their IDs
		await HabitLog.deleteMany({}); // Now delete all entries

		// Iterate over each Habit in the database
		const habits = await Habit.find({});
		for (const habit of habits) {
			let updated = false;
			habit.checkedInDays.forEach((value, key) => {
				if (value.habitLogId) {
					value.habitLogId = null;
					updated = true; // Flag to indicate this Habit needs saving
				}
			});
			// Save the Habit if any of its CheckedInDays were updated
			if (updated) {
				await habit.save();
			}
		}

		console.log('Deleted Habit Logs and updated Habits');
	} catch (err) {
		console.error('Error removing fields:', err);
	} finally {
		mongoose.disconnect(); // Ensures disconnection happens in both success and error cases
	}
};

removeAllOldHabitLogs();
