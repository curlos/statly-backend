import multer from 'multer';

// Use memory storage to get buffer for Cloudinary upload
const storage = multer.memoryStorage();

export const upload = multer({
	storage: storage,
	limits: {
		fileSize: 5 * 1024 * 1024, // 5MB limit
	},
	fileFilter: (req, file, cb) => {
		// Accept images only
		if (!file.mimetype.startsWith('image/')) {
			return cb(new Error('Only image files are allowed!'));
		}
		cb(null, true);
	},
});
