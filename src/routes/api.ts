import { Router } from 'express';
import entriesRouter from './entries';
import friendsRouter from './friends';
import tagsRouter from './tags';
import settingsRouter from './settings';
import { MAX_SUB_ENTRY_DEPTH } from '../config';

const router = Router();

// Mount all API routes
router.use('/entries', entriesRouter);
router.use('/friends', friendsRouter);
router.use('/tags', tagsRouter);
router.use('/settings', settingsRouter);

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Diary API is running',
        timestamp: new Date().toISOString()
    });
});

// Configuration endpoint
router.get('/config', (req, res) => {
    res.json({
        success: true,
        data: {
            maxSubEntryDepth: MAX_SUB_ENTRY_DEPTH
        }
    });
});

export default router;
