import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { FriendService } from '../services/friendService';
import { DiaryService } from '../services/diaryService';
import { requireAuth } from '../utils/auth';

const router = Router();

// GET /api/friends - Get all friends for the current user
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const friends = await FriendService.getUserFriends(userId);
        
        res.json({
            success: true,
            data: friends
        });
    } catch (error) {
        console.error('Error fetching friends:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch friends' 
        });
    }
});

// GET /api/friends/:id - Get a specific friend
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const friendId = new Types.ObjectId(req.params.id);
        
        const stats = await FriendService.getFriendStats(userId, friendId);
        
        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Error fetching friend:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch friend' 
        });
    }
});

// GET /api/friends/:id/entries - Get entries filtered for a specific friend
router.get('/:id/entries', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const friendId = new Types.ObjectId(req.params.id);
        
        const entries = await DiaryService.getEntriesForFriend(userId, friendId);
        
        res.json({
            success: true,
            data: entries
        });
    } catch (error) {
        console.error('Error fetching friend entries:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch entries for friend' 
        });
    }
});

// POST /api/friends - Create a new friend
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const { name, tagIds } = req.body;        if (!name || name.trim() === '') {
            res.status(400).json({ 
                success: false, 
                error: 'Friend name is required' 
            });
            return;
        }

        const friendData = {
            userId,
            name: name.trim(),
            tagIds: tagIds ? tagIds.map((id: string) => new Types.ObjectId(id)) : undefined
        };

        const friend = await FriendService.createFriend(friendData);
        
        res.status(201).json({
            success: true,
            data: friend
        });
    } catch (error) {
        console.error('Error creating friend:', error);
        if (error instanceof Error && error.message.includes('already exists')) {
            res.status(409).json({ 
                success: false, 
                error: error.message 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to create friend' 
            });
        }
    }
});

// PUT /api/friends/:id - Update an existing friend
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const friendId = new Types.ObjectId(req.params.id);
        const { name, tagIds } = req.body;

        const updates: any = {};
        if (name !== undefined) updates.name = name.trim();
        if (tagIds !== undefined) {
            updates.tagIds = tagIds.map((id: string) => new Types.ObjectId(id));
        }

        const friend = await FriendService.updateFriend(userId, friendId, updates);
        
        res.json({
            success: true,
            data: friend
        });
    } catch (error) {
        console.error('Error updating friend:', error);
        if (error instanceof Error && error.message.includes('not found')) {
            res.status(404).json({ 
                success: false, 
                error: error.message 
            });
        } else if (error instanceof Error && error.message.includes('already exists')) {
            res.status(409).json({ 
                success: false, 
                error: error.message 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to update friend' 
            });
        }
    }
});

// DELETE /api/friends/:id - Delete a friend
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const friendId = new Types.ObjectId(req.params.id);

        await FriendService.deleteFriend(userId, friendId);
        
        res.json({
            success: true,
            message: 'Friend deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting friend:', error);
        if (error instanceof Error && error.message.includes('not found')) {
            res.status(404).json({ 
                success: false, 
                error: error.message 
            });
        } else {
            res.status(500).json({ 
                success: false, 
                error: 'Failed to delete friend' 
            });
        }
    }
});

// PUT /api/friends/:id/hide-entry/:entryId - Hide an entry for a specific friend
router.put('/:id/hide-entry/:entryId', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const friendId = new Types.ObjectId(req.params.id);
        const entryId = new Types.ObjectId(req.params.entryId);

        await FriendService.hideEntryForFriend(userId, friendId, entryId);
        
        res.json({
            success: true,
            message: 'Entry hidden for friend'
        });
    } catch (error) {
        console.error('Error hiding entry for friend:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to hide entry for friend' 
        });
    }
});

// PUT /api/friends/:id/unhide-entry/:entryId - Unhide an entry for a specific friend
router.put('/:id/unhide-entry/:entryId', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const friendId = new Types.ObjectId(req.params.id);
        const entryId = new Types.ObjectId(req.params.entryId);

        await FriendService.unhideEntryForFriend(userId, friendId, entryId);
        
        res.json({
            success: true,
            message: 'Entry unhidden for friend'
        });
    } catch (error) {
        console.error('Error unhiding entry for friend:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to unhide entry for friend' 
        });
    }
});

export default router;
