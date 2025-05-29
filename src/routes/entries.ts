import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { DiaryService } from '../services/diaryService';
import { requireAuth } from '../utils/auth';

const router = Router();

// GET /api/entries - Get entries for the current user
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const dateParam = req.query.date as string;
        
        let entries;
        if (dateParam) {
            // Get entries for a specific date
            const targetDate = new Date(dateParam);
            entries = await DiaryService.getEntriesForDate(userId, targetDate);
        } else {
            // Get all visible entries (fallback for compatibility)
            entries = await DiaryService.getVisibleEntries(userId);
        }
        
        res.json({
            success: true,
            data: entries
        });
    } catch (error) {
        console.error('Error fetching entries:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch entries' 
        });
    }
});

// POST /api/entries - Create a new diary entry
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const { content, date, priority, tagIds, friendIds, parentEntryId } = req.body;

        if (!content || content.trim() === '') {
            res.status(400).json({ 
                success: false, 
                error: 'Content is required' 
            });
            return;
        }

        const entryData = {
            userId,
            content: content.trim(),
            date: date ? new Date(date) : undefined,
            priority: priority ? parseInt(priority) : undefined,
            tagIds: tagIds ? tagIds.map((id: string) => new Types.ObjectId(id)) : undefined,
            friendIds: friendIds ? friendIds.map((id: string) => new Types.ObjectId(id)) : undefined,
            parentEntryId: parentEntryId ? new Types.ObjectId(parentEntryId) : undefined
        };

        const entry = await DiaryService.createEntry(entryData);
        
        res.status(201).json({
            success: true,
            data: entry
        });
    } catch (error) {
        console.error('Error creating entry:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to create entry' 
        });
    }
});

// PUT /api/entries/:id - Update an existing diary entry
router.put('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const entryId = new Types.ObjectId(req.params.id);
        const { content, date, priority, tagIds, friendIds } = req.body;

        // Find the entry and verify ownership
        const { DiaryEntry } = await import('../models');
        const entry = await DiaryEntry.findOne({ _id: entryId, user: userId });
        
        if (!entry) {
            res.status(404).json({ 
                success: false, 
                error: 'Entry not found' 
            });
            return;
        }

        // Update fields if provided
        if (content !== undefined) entry.content = content.trim();
        if (date !== undefined) entry.date = new Date(date);
        if (priority !== undefined) entry.priority = parseInt(priority);
        if (tagIds !== undefined) {
            entry.tags = tagIds.map((id: string) => new Types.ObjectId(id));
        }
        if (friendIds !== undefined) {
            entry.friends = friendIds.map((id: string) => new Types.ObjectId(id));
        }

        await entry.save();
          res.json({
            success: true,
            data: entry
        });
    } catch (error) {
        console.error('Error updating entry:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update entry' 
        });
    }
});

// DELETE /api/entries/:id - Delete a diary entry
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const entryId = new Types.ObjectId(req.params.id);

        const { DiaryEntry } = await import('../models');

        const entry = await DiaryEntry.findOne({ _id: entryId, user: userId });
        
        if (!entry) {
            res.status(404).json({ 
                success: false, 
                error: 'Entry not found' 
            });
            return;
        }

        // Recursively delete the entry and all its descendants
        await deleteEntryRecursively(entryId, userId);
        
        res.json({
            success: true,
            message: 'Entry deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting entry:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to delete entry' 
        });
    }
});

// Helper function to recursively delete an entry and all its descendants
async function deleteEntryRecursively(entryId: Types.ObjectId, userId: Types.ObjectId): Promise<void> {
    const { DiaryEntry } = await import('../models');
    
    // Find all direct children of this entry
    const childEntries = await DiaryEntry.find({ 
        parentEntry: entryId, 
        user: userId 
    }).select('_id');
    
    // Recursively delete all children first
    for (const child of childEntries) {
        await deleteEntryRecursively(child._id as Types.ObjectId, userId);
    }
    
    // Finally, delete the entry itself
    await DiaryEntry.findByIdAndDelete(entryId);
}

export default router;
