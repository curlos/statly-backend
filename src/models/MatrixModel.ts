import mongoose, { Schema } from 'mongoose';
import BaseMatrixAndFilterSchema, { IBaseMatrixAndFilterSchema } from '../schemas/BaseMatrixAndFilterSchema';

interface IMatrix extends IBaseMatrixAndFilterSchema {}

const MatrixSchema: Schema = new Schema({
	...BaseMatrixAndFilterSchema.obj,
});

const Matrix = mongoose.model<IMatrix>('Matrix', MatrixSchema, 'matrices');

export default Matrix;
