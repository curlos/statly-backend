import express from 'express';
import bcrypt from 'bcryptjs';
import jwt, { Secret } from 'jsonwebtoken';
import User from '../models/UserModel';
import UserSettings from '../models/UserSettingsModel';
import cloudinary from '../config/cloudinary';
import { upload } from '../middleware/multer';
import { verifyToken } from '../middleware/verifyToken';
import { CustomRequest } from '../interfaces/CustomRequest';

// Email validation regex
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const validateEmail = (email: string): boolean => {
	return EMAIL_REGEX.test(email);
};

const validatePassword = (password: string): { valid: boolean; message?: string } => {
	if (password.length < 8) {
		return { valid: false, message: 'Password must be at least 8 characters long' };
	}
	if (!/[a-z]/.test(password)) {
		return { valid: false, message: 'Password must contain at least one lowercase letter' };
	}
	if (!/[A-Z]/.test(password)) {
		return { valid: false, message: 'Password must contain at least one uppercase letter' };
	}
	if (!/\d/.test(password)) {
		return { valid: false, message: 'Password must contain at least one number' };
	}
	if (!/[@$!%*?&]/.test(password)) {
		return { valid: false, message: 'Password must contain at least one special character (@$!%*?&)' };
	}
	return { valid: true };
};

const router = express.Router();

router.get('/logged-in-user', async (req, res) => {
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
			name: user.name,
			profilePic: user.profilePic,
			createdAt: user.createdAt,
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
		const { name, email, password } = req.body;

		// Validate all fields are present
		if (!name || !email || !password) {
			return res.status(400).json({ message: 'Name, email, and password are required.' });
		}

		// Trim and validate name
		const trimmedName = name.trim();
		if (trimmedName.length === 0) {
			return res.status(400).json({ message: 'Name cannot be empty or only whitespace.' });
		}

		// Trim and validate email format
		const trimmedEmail = email.trim().toLowerCase();
		const displayEmail = email.trim(); // Preserve original casing
		if (!validateEmail(trimmedEmail)) {
			return res.status(400).json({ message: 'Please provide a valid email address.' });
		}

		// Validate password strength
		const passwordValidation = validatePassword(password);
		if (!passwordValidation.valid) {
			return res.status(400).json({ message: passwordValidation.message });
		}

		// Check for existing user by email (using lowercase for comparison)
		const existingUser = await User.findOne({ email: trimmedEmail });
		if (existingUser) {
			return res.status(400).json({ message: 'User with this email already exists' });
		}

		// Create a new user with trimmed/sanitized values
		const user = new User({
			name: trimmedName,
			email: trimmedEmail,
			displayEmail: displayEmail,
			password // Will be hashed by pre-save hook
		});
		await user.save();

		// Create default settings for the new user with 3 rings
		const now = new Date().toISOString();
		// Base defaults shared by all rings
		const baseRingDefaults = {
			useThemeColor: false,
			projects: {},
			goalSeconds: 3600,
			showStreakCount: true,
			goalDays: 7,
			showGoalDays: true,
			selectedDaysOfWeek: {
				monday: true,
				tuesday: true,
				wednesday: true,
				thursday: true,
				friday: true,
				saturday: true,
				sunday: true
			},
			restDays: {},
			customDailyFocusGoal: {},
			inactivePeriods: [],
			createdAt: now,
			updatedAt: now
		};

		const userSettings = new UserSettings({
			userId: user._id,
			habit: {
				showInTimedSmartLists: true,
			},
			tickTickOne: {
				pages: {
					focusHoursGoal: {
						rings: [
							{
								...baseRingDefaults,
								id: `ring-1-${user._id}`,
								name: 'Ring 1',
								color: '#fa114f',
								isActive: true
							},
							{
								...baseRingDefaults,
								id: `ring-2-${user._id}`,
								name: 'Ring 2',
								color: '#a6ff00',
								isActive: false
							},
							{
								...baseRingDefaults,
								id: `ring-3-${user._id}`,
								name: 'Ring 3',
								color: '#00fff6',
								isActive: false
							}
						]
					}
				}
			}
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

		// Validate input presence
		if (!email || !password) {
			return res.status(400).json({ message: 'Email and password are required' });
		}

		// Trim and validate email format
		const trimmedEmail = email.trim().toLowerCase();
		if (!validateEmail(trimmedEmail)) {
			return res.status(400).json({ message: 'Please provide a valid email address.' });
		}

		// Check if the user exists (using lowercase for comparison)
		const user = await User.findOne({ email: trimmedEmail });
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

router.put('/update-profile', verifyToken, upload.single('profilePic'), async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { name, email, currentPassword } = req.body;
		const file = req.file;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		let hasChanges = false;

		// If email is being changed, require password confirmation
		if (email && email.toLowerCase() !== user.email) {
			if (!currentPassword) {
				return res.status(400).json({ message: 'Current password required to change email' });
			}

			const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
			if (!isPasswordValid) {
				return res.status(401).json({ message: 'Invalid current password' });
			}

			// Validate email format
			const trimmedEmail = email.trim().toLowerCase();
			if (!validateEmail(trimmedEmail)) {
				return res.status(400).json({ message: 'Please provide a valid email address' });
			}

			// Check email uniqueness
			const existingUser = await User.findOne({ email: trimmedEmail });
			if (existingUser && existingUser._id.toString() !== userId) {
				return res.status(400).json({ message: 'Email already in use' });
			}

			user.email = trimmedEmail;
			user.displayEmail = email.trim();
			hasChanges = true;
		}

		// Update name if provided and different
		if (name) {
			const trimmedName = name.trim();
			if (trimmedName.length === 0) {
				return res.status(400).json({ message: 'Name cannot be empty' });
			}
			if (trimmedName !== user.name) {
				user.name = trimmedName;
				hasChanges = true;
			}
		}

		// Upload profile picture to Cloudinary if provided
		if (file) {
			const uploadResult: any = await new Promise((resolve, reject) => {
				const stream = cloudinary.uploader.upload_stream(
					{
						resource_type: 'image',
						folder: `Statly/users/${userId}/profilePic`,
						public_id: `${Date.now()}-${file.originalname?.split('.')[0] || 'profile'}`,
						quality: 'auto:good', // Good quality with compression
						fetch_format: 'auto', // Automatic format selection (WebP, AVIF, etc.)
						width: 500, // Resize to reasonable profile pic size
						height: 500,
						crop: 'fill', // Fill the dimensions, cropping if needed
						gravity: 'face', // Focus on faces when cropping
					},
					(error, result) => {
						if (error) reject(error);
						else resolve(result);
					}
				);
				stream.end(file.buffer);
			});

			user.profilePic = uploadResult.secure_url;
			hasChanges = true;
		}

		// Only save if there are actual changes
		if (hasChanges) {
			await user.save();
		}

		res.json({
			_id: user._id,
			email: user.email,
			name: user.name,
			profilePic: user.profilePic,
			createdAt: user.createdAt,
		});
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to update profile',
		});
	}
});

router.put('/update-password', verifyToken, async (req: CustomRequest, res) => {
	try {
		const userId = req.user?.userId;
		const { currentPassword, newPassword } = req.body;

		if (!userId) {
			return res.status(401).json({ message: 'Unauthorized' });
		}

		if (!currentPassword || !newPassword) {
			return res.status(400).json({ message: 'Current password and new password are required' });
		}

		const user = await User.findById(userId);
		if (!user) {
			return res.status(404).json({ message: 'User not found' });
		}

		// Verify current password
		const isPasswordValid = await bcrypt.compare(currentPassword, user.password);
		if (!isPasswordValid) {
			return res.status(401).json({ message: 'Invalid current password' });
		}

		// Check if new password is the same as current password
		const isSamePassword = await bcrypt.compare(newPassword, user.password);
		if (isSamePassword) {
			return res.status(400).json({ message: 'New password must be different from current password' });
		}

		// Validate new password strength
		const passwordValidation = validatePassword(newPassword);
		if (!passwordValidation.valid) {
			return res.status(400).json({ message: passwordValidation.message });
		}

		// Update password (will be hashed by pre-save hook)
		user.password = newPassword;
		await user.save();

		res.json({ message: 'Password updated successfully' });
	} catch (error) {
		res.status(500).json({
			message: 'Server error',
			error: error instanceof Error ? error.message : 'Failed to update password',
		});
	}
});

export default router;
