import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

interface IUser extends Document {
	email: string;
	displayEmail: string;
	password: string;
	name?: string;
	profilePic?: string;
	createdAt: Date;
	updatedAt: Date;
	isModified(path: string): boolean;
}

const userSchema = new Schema<IUser>({
	name: {
		type: String,
		trim: true,
	},
	email: {
		type: String,
		required: true,
		unique: true,
		lowercase: true,
		trim: true,
		validate: {
			validator: function(v: string) {
				return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
			},
			message: 'Please provide a valid email address'
		}
	},
	displayEmail: {
		type: String,
		required: true,
		trim: true,
	},
	password: {
		type: String,
		required: true,
	},
	profilePic: {
		type: String,
		trim: true,
	},
}, {
	timestamps: true
});

// Pre-save hook to hash the password before saving
userSchema.pre('save', async function (next) {
	const user = this as IUser;
	if (user.isModified('password')) {
		user.password = await bcrypt.hash(user.password, 12);
	}
	next();
});

const User = mongoose.model<IUser>('User', userSchema);

export default User;
