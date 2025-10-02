import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const ATLAS_URI = process.env.ATLAS_URI;

export const connectDB = async () => {
	if (!ATLAS_URI) {
		console.error('ATLAS_URI is not defined in your env variables');
		process.exit(1); // Exit process with failure
	}

	try {
		const conn = await mongoose.connect(ATLAS_URI);
		console.log(`MongoDB Connected: ${conn.connection.host}`);
	} catch (error) {
		// Use type assertion to treat error as an instance of Error
		if (error instanceof Error) {
			console.error(`Error: ${error.message}`);
		} else {
			console.error(`An unexpected error occurred`);
		}
		process.exit(1);
	}
};

export default connectDB;
