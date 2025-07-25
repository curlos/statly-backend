import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const ATLAS_URI = process.env.ATLAS_URI;

if (!ATLAS_URI) {
	console.error('❌ ATLAS_URI is not defined');
	process.exit(1);
}

let cached = (global as any).mongoose;

if (!cached) {
	cached = (global as any).mongoose = { conn: null, promise: null };
}

export const connectDB = async () => {
	if (cached.conn) return cached.conn;

	if (!cached.promise) {
		console.log('⏳ Connecting to MongoDB...');
		cached.promise = mongoose.connect(ATLAS_URI, {
			bufferCommands: false,
		});
	}

	try {
		cached.conn = await cached.promise;
		console.log(`✅ MongoDB Connected: ${cached.conn.connection.host}`);
		return cached.conn;
	} catch (error) {
		console.error(`❌ MongoDB connection failed:`, error);
		throw error;
	}
};

export default connectDB;
