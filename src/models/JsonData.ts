import mongoose, { Schema } from 'mongoose';

const jsonDataSchema = new Schema({
	name: { type: String, required: true, unique: true }, // Unique name identifier for the data type
	updatedAt: { type: Date, default: Date.now }, // Timestamp for the last update
	data: Schema.Types.Mixed, // The actual JSON data
});

const JsonData = mongoose.model('JsonData', jsonDataSchema);

export default JsonData;
