import dotenv from 'dotenv';
// src/index.ts
import express from 'express';
import cors from 'cors';
import connectDB from './db/database'; // Import the connectDB function

// Routes
import ticktickRouter from './routes/ticktickRouter';
import tempRouter from './routes/tempRouter';
import usersRouter from './routes/usersRouter';
import settingsRouter from './routes/userSettingsRouter';
import oldFocusAppsRouter from './routes/oldFocusAppsRouter';
import documentsFocusRecordsRouter from './routes/documents/documentsFocusRecordsRouter';
import documentsTasksRouter from './routes/documents/documentsTasksRouter'
import documentsSyncRouter from './routes/documents/documentsSyncRouter'
import documentsProjectsRouter from './routes/documents/documentsProjectsRouter'
import documentsStatsRouter from './routes/documents/documentsStatsRouter'

dotenv.config();

const app = express();

const allowedOrigins = [
  'http://localhost:5173', // local frontend
  'https://ticktick-2-0-web.vercel.app' // deployed frontend
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

// ✅ Connect to database once on startup
connectDB()
  .then(() => {
    return
  })
  .catch((err) => console.error('❌ Failed to connect to DB:', err));

app.use(express.json()); // Middleware to parse JSON bodies

app.use('/documents/focus-records', documentsFocusRecordsRouter);
app.use('/documents/tasks', documentsTasksRouter);
app.use('/documents/projects', documentsProjectsRouter);
app.use('/documents/sync', documentsSyncRouter);
app.use('/documents/stats', documentsStatsRouter);
app.use('/users', usersRouter);
app.use('/user-settings', settingsRouter);

// Old routes
app.use('/ticktick', ticktickRouter);
app.use('/ticktick', tempRouter);
app.use('/old-focus-apps', oldFocusAppsRouter);

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