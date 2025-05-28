import { Router, Request, Response } from "express";
import passport from "passport";

const router: Router = Router();

router.get("/google", (req, res, next) => {
    passport.authenticate("google", { scope: ["profile", "email"] }, (err, user) => {
        if (err) {
            console.error("Error during authentication:", err);
            return next(err);
        }
        if (!user) {
            console.error("No user found during authentication");
            return res.redirect("/");
        }
        req.logIn(user, (err) => {
            if (err) {
                console.error("Error logging in user:", err);
                return next(err);
            }
            return res.redirect("/admin/");
        });
    })(req, res, next);
});

router.get(
    "/google/callback",
    passport.authenticate("google", { failureRedirect: "/" }),
    (req: Request, res: Response) => {
        res.redirect("/admin/");
    }
);

export default router;
