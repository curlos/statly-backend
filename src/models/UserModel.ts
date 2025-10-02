import mongoose, { Document, Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

interface IUser extends Document {
	email: string;
	password: string;
	nickname?: string;
	isModified(path: string): boolean;
}

const userSchema = new Schema<IUser>({
	nickname: {
		type: String,
	},
	email: {
		type: String,
		required: true,
		unique: true,
	},
	password: {
		type: String,
		required: true,
	},
});

// Pre-save hook to hash the password before saving
userSchema.pre('save', async function (next) {
	const user = this as IUser;
	if (user.isModified('password')) {
		user.password = await bcrypt.hash(user.password, 8);
	}
	next();
});

const User = mongoose.model<IUser>('User', userSchema);

export default User;
