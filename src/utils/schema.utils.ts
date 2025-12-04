import { Schema } from 'mongoose';

/**
 * Applies middleware to enforce userId in all filter-based queries
 * Prevents accidental cross-user data leaks by requiring userId in query filters
 *
 * @param schema - Mongoose schema to apply enforcement to
 */
export const applyUserIdEnforcement = (schema: Schema): void => {
	const queryTypesRequiringUserId = [
		'find',
		'findOne',
		'findOneAndUpdate',
		'findOneAndDelete',
		'findOneAndReplace',
		'findOneAndRemove',
		'updateOne',
		'updateMany',
		'deleteOne',
		'deleteMany',
		'replaceOne',
		'count',
		'countDocuments',
		'exists'
	];

	queryTypesRequiringUserId.forEach((queryType) => {
		schema.pre(queryType as any, function (this: any, next) {
			const query = this.getFilter();

			// Check if userId exists in the query
			if (!query.userId) {
				return next(new Error(`Query operation '${queryType}' requires userId in filter`));
			}

			next();
		});
	});
};
