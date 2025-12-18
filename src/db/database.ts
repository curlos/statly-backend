import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const ATLAS_URI = process.env.ATLAS_URI;

if (!ATLAS_URI) {
	console.error('❌ ATLAS_URI is not defined');
	process.exit(1);
}

interface MongooseCache {
	conn: typeof mongoose | null;
	promise: Promise<typeof mongoose> | null;
}

let cached = (global as Record<string, unknown>).mongoose as MongooseCache | undefined;

if (!cached) {
  cached = (global as Record<string, unknown>).mongoose = { conn: null, promise: null } as MongooseCache;
}

export const connectDB = async () => {
  if (!cached) {
    throw new Error('Database cache not initialized');
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    console.log('⏳ Connecting to MongoDB...');
    cached.promise = mongoose.connect(process.env.ATLAS_URI!, {
      bufferCommands: false,
    });
  }

  try {
    cached.conn = await cached.promise;
    console.log(`✅ MongoDB Connected: ${cached.conn.connection.host}`);
    return cached.conn;
  } catch (error) {
    cached.promise = null; // 💡 Reset so next call can retry
    console.error(`❌ MongoDB connection failed:`, error);
    throw error;
  }
};

export default connectDB