import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { TagService } from '../services/tagService';
import { requireAuth } from '../utils/auth';

const router = Router();

// GET /api/tags - Get all tags for the current user
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const tags = await TagService.getUserTags(userId);
        
        res.json({
            success: true,
            data: tags
        });
    } catch (error) {
        console.error('Error fetching tags:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch tags' 
        });
    }
});

// GET /api/tags/stats - Get tag usage statistics
router.get('/stats', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const stats = await TagService.getTagUsageStats(userId);
        
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error fetching tag stats:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch tag statistics' 
        });
    }
});

// GET /api/tags/suggestions - Get suggested tags based on content
router.get('/suggestions', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const content = req.query.content as string;

        if (!content) {
            res.status(400).json({ 
                success: false, 
                error: 'Content parameter is required' 
            });
        }

        const suggestions = await TagService.getSuggestedTags(userId, content);
        
        res.json({
            success: true,
            data: suggestions
        });
    } catch (error) {
        console.error('Error getting tag suggestions:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get tag suggestions' 
        });
    }
});

// POST /api/tags - Create a new tag
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const { name, color } = req.body;

        if (!name || name.trim() === '') {
            res.status(400).json({ 
                success: false, 
                error: 'Tag name is required' 
            });
        }

        const tagData = {
            userId,
            name: name.trim(),
            color: color || undefined
        };

        const tag = await TagService.createTag(tagData);
        
        res.status(201).json({
            success: true,
            data: tag
        });
    } catch (error) {
        console.error('Error creating tag:', error);
        if (error instanceof Error && error.message.includes('already exists')) {
            res.status(409).json({ 
                success: false, 
                error: error.message 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to create tag' 
            });
        }
    }
});

// PUT /api/tags/:id - Update an existing tag
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const tagId = new Types.ObjectId(req.params.id);
        const { name, color } = req.body;

        const updates: any = {};
        if (name !== undefined) updates.name = name.trim();
        if (color !== undefined) updates.color = color;

        const tag = await TagService.updateTag(userId, tagId, updates);
        
        res.json({
            success: true,
            data: tag
        });
    } catch (error) {
        console.error('Error updating tag:', error);
        if (error instanceof Error && error.message.includes('not found')) {
            res.status(404).json({ 
                success: false, 
                error: 'Tag not found' 
            });
        } else if (error instanceof Error && error.message.includes('already exists')) {
            res.status(409).json({ 
                success: false, 
                error: error.message 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to update tag' 
            });
        }
    }
});

// DELETE /api/tags/:id - Delete a tag
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const tagId = new Types.ObjectId(req.params.id);

        await TagService.deleteTag(userId, tagId);
        
        res.json({
            success: true,
            message: 'Tag deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting tag:', error);
        if (error instanceof Error && error.message.includes('not found')) {
            res.status(404).json({ 
                success: false, 
                error: error.message 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to delete tag' 
            });
        }
    }
});

export default router;
