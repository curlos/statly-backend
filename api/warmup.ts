import connectDB from '../src/db/database';

export default async function handler(req: any, res: any) {
	try {
		// Establish MongoDB connection
		await connectDB();

		return res.status(200).json({
			status: 'warm',
			timestamp: new Date().toISOString(),
			message: 'Connection established'
		});
	} catch (error) {
		return res.status(500).json({
			status: 'error',
			error: error instanceof Error ? error.message : 'Unknown error'
		});
	}
}
