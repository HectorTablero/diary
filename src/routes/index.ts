import { Router, Request, Response } from "express";
import { isAuthorized } from '../utils/auth';

const router: Router = Router();

router.get("/", (req: Request, res: Response) => {
    // If user is logged in, redirect to diary
    if (req.user) {
        res.redirect("/diary");
    } else {
        // If not logged in, redirect to auth
        res.redirect("/auth/google");
    }
});

// GET /diary - Main diary page
router.get('/diary', isAuthorized, (req: Request, res: Response) => {
    res.render('diary', {
        title: 'My Diary',
        user: (req as any).user
    });
});

// GET /diary/friends - Friends management page
router.get('/friends', isAuthorized, (req: Request, res: Response) => {
    res.render('friends', {
        title: 'Manage Friends',
        user: (req as any).user
    });
});

// GET /diary/tags - Tags management page
router.get('/tags', isAuthorized, (req: Request, res: Response) => {
    res.render('tags', {
        title: 'Manage Tags',
        user: (req as any).user
    });
});

// GET /diary/settings - Settings page
router.get('/settings', isAuthorized, (req: Request, res: Response) => {
    res.render('settings', {
        title: 'Settings',
        user: (req as any).user
    });
});

export default router;
