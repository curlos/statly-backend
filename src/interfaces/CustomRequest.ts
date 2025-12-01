import { JwtPayload } from 'jsonwebtoken';
import { Request } from 'express';
import { Types } from 'mongoose';

export interface CustomRequest extends Request {
	user?: JwtPayload & {
		userId: Types.ObjectId;
	};
}
