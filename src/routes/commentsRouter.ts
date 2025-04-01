import express from 'express';
import Comment from '../models/CommentModel';
import { verifyToken } from '../middleware/verifyToken';

const router = express.Router();

router.get('/', verifyToken, async (req, res) => {
	try {
		const comments = await Comment.find({});
		res.status(200).json(comments);
	} catch (error) {
		res.status(500).json({
			message: error instanceof Error ? error.message : 'An error occurred fetching the tasks',
		});
	}
});

router.post('/add', verifyToken, async (req, res) => {
	try {
		const { taskId, authorId, content } = req.body;

		const newComment = new Comment({
			taskId,
			authorId,
			content,
		});

		await newComment.save();

		res.status(201).json({
			message: 'Comment added successfully',
			comment: newComment,
		});
	} catch (error: any) {
		console.error('Failed to add comment:', error);
		res.status(500).json({
			message: 'Failed to add comment',
			error: error.message,
		});
	}
});

router.put('/edit/:commentId', verifyToken, async (req, res) => {
	const { commentId } = req.params;
	const { content } = req.body;

	try {
		const updatedComment = await Comment.findByIdAndUpdate(
			commentId,
			{ content },
			{ new: true, runValidators: true }
		);

		if (!updatedComment) {
			return res.status(404).json({ message: 'Comment not found' });
		}

		res.status(200).json({
			message: 'Comment updated successfully',
			comment: updatedComment,
		});
	} catch (error: any) {
		console.error('Failed to update comment:', error);
		res.status(500).json({
			message: 'Failed to update comment',
			error: error.message,
		});
	}
});

router.delete('/delete/:commentId', verifyToken, async (req, res) => {
	const { commentId } = req.params;

	try {
		const deletedComment = await Comment.findByIdAndDelete(commentId);

		if (!deletedComment) {
			return res.status(404).json({ message: 'Comment not found' });
		}

		res.status(200).json({
			message: 'Comment deleted successfully',
			comment: deletedComment,
		});
	} catch (error: any) {
		console.error('Failed to delete comment:', error);
		res.status(500).json({
			message: 'Failed to delete comment',
			error: error.message,
		});
	}
});

export default router;
