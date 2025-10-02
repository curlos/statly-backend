import express from 'express';
import bcrypt from 'bcryptjs';
import jwt, { Secret } from 'jsonwebtoken';
import User from '../models/UserModel';
import UserSettings from '../models/UserSettingsModel';

const router = express.Router();

router.get('/', async (req, res) => {
	try {
		const users = await User.find({});
		res.status(200).json(users);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the tasks',
		});
	}
});

router.get('/logged-in', async (req, res) => {
	const token = req.headers.authorization?.split(' ')[1]; // Safely access the token

	if (!token) {
		return res.status(401).json({ message: 'No token provided' });
	}

	try {
		const JWT_SECRET = process.env.JWT_SECRET as Secret;
		if (!JWT_SECRET) {
			return res.status(500).json({ message: 'JWT secret is not defined' });
		}

		const decoded = jwt.verify(token, JWT_SECRET); // Use JWT_SECRET safely

		if (typeof decoded !== 'object' || !decoded.userId) {
			return res.status(401).json({ message: 'Invalid token' });
		}

		const user = await User.findById(decoded.userId);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		res.json({
			_id: user._id,
			email: user.email,
			nickname: user.nickname,
		});
	} catch (error) {
		if (typeof error === 'string') {
			return res.status(401).json({ message: error });
		} else if (error instanceof Error) {
			return res.status(401).json({ message: error.message });
		}
		return res.status(500).json({ message: 'Failed to retrieve user details' });
	}
});

router.post('/register', async (req, res) => {
	try {
		const { nickname, email, password } = req.body;

		// Validate input: email and password are required, nickname is optional
		if (!email || !password) {
			return res.status(400).json({ message: 'Email and password are required' });
		}

		// Check for existing user by email only (since email needs to be unique)
		const existingUser = await User.findOne({ email });
		if (existingUser) {
			return res.status(400).json({ message: 'User with this email already exists' });
		}

		// Create a new user with the provided email, optional nickname, and password
		const user = new User({ nickname, email, password });
		await user.save();

		// Create default settings for the new user
		const userSettings = new UserSettings({
			userId: user._id, // Link to the newly created user
			habit: {
				showInTimedSmartLists: true, // Default value, can add more fields as necessary
			},
		});
		await userSettings.save();

		// Create a JWT token for the newly registered user
		const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || '', { expiresIn: '30d' });

		res.status(201).json({
			token,
			user,
		});
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'An error creating user',
		});
	}
});

router.post('/login', async (req, res) => {
	try {
		const { email, password } = req.body;

		// Validate input
		if (!email || !password) {
			return res.status(400).json({ message: 'Email and password are required' });
		}

		// Check if the user exists
		const user = await User.findOne({ email });
		if (!user) {
			return res.status(401).json({ message: 'Invalid email or password' });
		}

		// Compare the provided password with the hashed password in the database
		const isMatch = await bcrypt.compare(password, user.password);
		if (!isMatch) {
			return res.status(401).json({ message: 'Invalid email or password' });
		}

		// User is valid, create a JWT token
		const token = jwt.sign(
			{ userId: user._id },
			process.env.JWT_SECRET || '',
			// TODO: Investigate this later and have BOTH an access token and refresh token. For now though it's annoying for it to be deleted everytime so expires in will be longer. But later on when it's fixed, it should be at most an hour or so.
			{ expiresIn: '30d' }
		);

		res.json({
			token,
			user,
		});
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'An error logging in user',
		});
	}
});

export default router;
