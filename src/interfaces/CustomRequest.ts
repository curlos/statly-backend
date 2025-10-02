import { JwtPayload } from 'jsonwebtoken';
import { Request } from 'express';

export interface CustomRequest extends Request {
	user?: JwtPayload;
}
