import app from '../src/app';
import connectDB from '../src/db/database';

// Ensure database is connected before handling requests
export default async function handler(req: any, res: any) {
	await connectDB();
	return app(req, res);
}
