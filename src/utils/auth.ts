import { Request, Response, NextFunction } from 'express';

function isAuthorized(req: Request, res: Response, next: NextFunction): void {
    if (req.isAuthenticated()) return next();
    res.redirect("/auth/google");
}

function isNotAuthorized(req: Request, res: Response, next: NextFunction): void {
    if (!req.isAuthenticated()) return next();
    res.status(404).render("errors/404");
}

// Middleware for API routes that require authentication
function requireAuth(req: Request, res: Response, next: NextFunction): void {
    if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
    }
    next();
}

export { isAuthorized, isNotAuthorized, requireAuth };
