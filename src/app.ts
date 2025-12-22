import dotenv from 'dotenv';
// src/index.ts
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import connectDB from './db/database'; // Import the connectDB function

// Routes
import usersRouter from './routes/usersRouter';
import settingsRouter from './routes/userSettingsRouter';
import deleteRouter from './routes/deleteRouter';
import streaksRouter from './routes/streaksRouter';
import focusRecordsRouter from './routes/focusRecordsRouter';
import tasksRouter from './routes/tasksRouter'
import syncRouter from './routes/syncRouter'
import projectsRouter from './routes/projectsRouter'
import statsRouter from './routes/statsRouter'
import importRouter from './routes/importRouter'
import customImagesRouter from './routes/customImagesRouter'
import customImageFoldersRouter from './routes/customImageFoldersRouter'

dotenv.config();

const app = express();

const allowedOrigins = [
  'http://localhost:5173', // local frontend site
  'https://statly-pi.vercel.app' // deployed frontend site
];

// ✅ Dynamically allow based on origin
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true, // Optional if using cookies/auth headers
  })
);

// ✅ Handle preflight
app.options('*', cors());

// ✅ Connect to database once on startup (only for local development)
if (!process.env.VERCEL) {
	connectDB()
		.then(() => {
			console.log('✅ Database connected for local development');
		})
		.catch((err) => console.error('❌ Failed to connect to DB:', err));
}

// Enable GZIP compression for all responses
app.use(compression());

app.use(express.json()); // Middleware to parse JSON bodies

// Health check endpoint for warmup (no auth required)
app.get('/health', (req, res) => {
	res.status(200).json({
		status: 'ok',
		timestamp: new Date().toISOString()
	});
});

app.use('/focus-records', focusRecordsRouter);
app.use('/tasks', tasksRouter);
app.use('/projects', projectsRouter);
app.use('/sync', syncRouter);
app.use('/stats', statsRouter);
app.use('/import', importRouter);
app.use('/users', usersRouter);
app.use('/user-settings', settingsRouter);
app.use('/delete', deleteRouter);
app.use('/streaks', streaksRouter);
app.use('/custom-images', customImagesRouter);
app.use('/custom-image-folders', customImageFoldersRouter);

app.get('/', (req, res) => {
	res.send('Hello World!');
});

// Only listen on a port if the script is run locally
if (!process.env.VERCEL) {
	// Vercel sets process.env.VERCEL = 1 during runtime
	const port = process.env.PORT || 8888;
	app.listen(port, () => {
		console.log(`Listening on port ${port}`);
	});
}

export default app;