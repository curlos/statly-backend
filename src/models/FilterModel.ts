import mongoose, { Schema } from 'mongoose';
import BaseMatrixAndFilterSchema, { IBaseMatrixAndFilterSchema } from '../schemas/BaseMatrixAndFilterSchema';

interface IMatrix extends IBaseMatrixAndFilterSchema {}

const MatrixSchema: Schema = new Schema({
	...BaseMatrixAndFilterSchema.obj,
});

const Filter = mongoose.model<IMatrix>('Filter', MatrixSchema, 'filters');

export default Filter;
