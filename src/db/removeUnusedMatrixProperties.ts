import mongoose from 'mongoose';
import Matrix from '../models/MatrixModel';
import connectDB from './database';

const removeUnusedMatrixProperties = async () => {
	try {
		await connectDB();

		const result = await Matrix.updateMany({}, { $unset: { selectedDates: '', selectedProjects: '' } });
		console.log('Fields removed:', result);
	} catch (err) {
		console.error('Error removing fields:', err);
	} finally {
		mongoose.disconnect(); // Ensures disconnection happens in both success and error cases
	}
};

removeUnusedMatrixProperties();
