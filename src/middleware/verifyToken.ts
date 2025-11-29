import jwt, { JwtPayload } from 'jsonwebtoken';
import { Response, NextFunction } from 'express';
import { CustomRequest } from '../interfaces/CustomRequest';
import dotenv from 'dotenv';

dotenv.config();

export const verifyToken = (req: CustomRequest, res: Response, next: NextFunction) => {
	const token = req.headers['authorization']?.split(' ')[1]; // Assuming token is sent as "Bearer {token}"

	if (!token) {
		return res.status(401).json({ message: 'No token provided' });
	}

	try {
		const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as JwtPayload;
		
		req.user = decoded; // Attach the user payload from the token to the request object
		next();
	} catch (error) {
		res.status(401).json({ message: 'Invalid token' });
	}
};
