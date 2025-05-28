import { Router, Request, Response } from 'express';
import { Types } from 'mongoose';
import { DiaryService } from '../services/diaryService';
import { requireAuth } from '../utils/auth';

const router = Router();

// GET /api/settings/priority-durations - Get current priority duration settings
router.get('/priority-durations', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);        const { User } = await import('../models');
        
        const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
            return;
        }
        
        res.json({
            success: true,
            data: user.settings.priorityDurations
        });
    } catch (error) {
        console.error('Error fetching priority durations:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch priority duration settings' 
        });
    }
});

// PUT /api/settings/priority-durations - Update priority duration settings
router.put('/priority-durations', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const durations = req.body;        // Validate the durations object
        if (!durations || typeof durations !== 'object') {
            res.status(400).json({ 
                success: false, 
                error: 'Invalid durations object' 
            });
            return;
        }        // Validate required priority levels and that they are positive numbers
        const requiredLevels = [1, 2, 3, 4, 5];        for (const level of requiredLevels) {
            if (!(level in durations) || typeof durations[level] !== 'number' || durations[level] <= 0) {
                res.status(400).json({ 
                    success: false, 
                    error: `Priority level ${level} must be a positive number` 
                });
                return;
            }
        }

        const updatedUser = await DiaryService.updatePriorityDurations(userId, {
            1: Math.floor(durations[1]),
            2: Math.floor(durations[2]),
            3: Math.floor(durations[3]),
            4: Math.floor(durations[4]),
            5: Math.floor(durations[5])
        });if (!updatedUser) {
            res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
            return;
        }
        
        res.json({
            success: true,
            data: updatedUser.settings.priorityDurations,
            message: 'Priority duration settings updated successfully'
        });
    } catch (error) {
        console.error('Error updating priority durations:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update priority duration settings' 
        });
    }
});

// GET /api/settings - Get all user settings
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
    try {
        const userId = new Types.ObjectId((req.user as any).id);
        const { User } = await import('../models');
          const user = await User.findById(userId);
        if (!user) {
            res.status(404).json({ 
                success: false, 
                error: 'User not found' 
            });
            return;
        }
        
        res.json({
            success: true,
            data: user.settings
        });
    } catch (error) {
        console.error('Error fetching user settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to fetch user settings' 
        });
    }
});

export default router;
