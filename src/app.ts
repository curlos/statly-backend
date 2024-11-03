import killPort from 'kill-port';
import dotenv from 'dotenv';
// src/index.ts
import express from 'express';
import cors from 'cors';
import connectDB from './db/database'; // Import the connectDB function

// Routes
import allDataRouter from './routes/TickTick-1.0-Routes/allDataRouter';
import tempRouter from './routes/TickTick-1.0-Routes/tempRouter';

import tasksRouter from './routes/tasksRouter';
import projectsRouter from './routes/projectsRouter';
import focusRecordsRouter from './routes/focusRecordsRouter';
import usersRouter from './routes/usersRouter';
import commentsRouter from './routes/commentsRouter';
import matricesRouter from './routes/matricesRouter';
import tagsRouter from './routes/tagsRouter';
import filtersRouter from './routes/filtersRouter';
import habitsRouter from './routes/habitsRouter';
import habitSectionsRouter from './routes/habitSectionsRouter';
import habitLogsRouter from './routes/habitLogsRouter';
import settingsRouter from './routes/userSettingsRouter';

dotenv.config();

const app = express();
const PORT = 8888;

// Connect to MongoDB
connectDB();

app.use(express.json()); // Middleware to parse JSON bodies

// Use it before all route definitions
app.use(
	cors({
		origin: '*', // or use "*" to allow all origins
	})
);

// This is for the TickTick 1.0 Data that I'm currently using until I finish TickTick 2.0 and migrate all my data into the DB
app.use('/ticktick-1.0', allDataRouter);
app.use('/ticktick-1.0', tempRouter);

app.use('/tasks', tasksRouter);
app.use('/projects', projectsRouter);
app.use('/focus-records', focusRecordsRouter);
app.use('/users', usersRouter);
app.use('/comments', commentsRouter);
app.use('/matrices', matricesRouter);
app.use('/tags', tagsRouter);
app.use('/filters', filtersRouter);
app.use('/habits', habitsRouter);
app.use('/habit-sections', habitSectionsRouter);
app.use('/habit-logs', habitLogsRouter);
app.use('/user-settings', settingsRouter);

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

module.exports = app;

// TODO: Maybe come back to this later. I think I was using this to debug node.js code but was having problems with this killing my ports when the server started so was useless. For the far future.

// killPort(PORT, 'tcp').then(() => {
//     console.log(`Port ${PORT} cleared`);
// }).catch((error) => {
//     console.log(`No process on port ${PORT}: ${error.message}`);
// }).finally(() => {
//     app.listen(PORT, () => {
//         console.log(`Server running at http://localhost:${PORT}`);
//     });
// });
