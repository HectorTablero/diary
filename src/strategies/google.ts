import passport, { Profile } from "passport";
import { Strategy, VerifyCallback } from "passport-google-oauth20";
import { User } from "../models/user";
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from "../config";

passport.use(
    new Strategy(
        {
            clientID: GOOGLE_CLIENT_ID,
            clientSecret: GOOGLE_CLIENT_SECRET,
            callbackURL: "/auth/google/callback"
        },
        async (
            accessToken: string,
            refreshToken: string,
            profile: Profile,
            done: VerifyCallback
        ) => {
            if (profile.emails === undefined) return done(null, false);

            let existingUser;
            existingUser = await User.findOneAndUpdate(
                { email: profile.emails[0].value },
                {
                    email: profile.emails[0].value,
                    name: profile.displayName,
                    photo: profile.photos
                        ? profile.photos[0].value
                        : "https://i.pinimg.com/736x/2c/f5/58/2cf558ab8c1f12b43f7326945672805e.jpg"
                },
                { new: true, upsert: true }
            );

            return done(null, existingUser);
        }
    )
);

passport.serializeUser((user, done) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    done(null, (user as any).id);
});

passport.deserializeUser(async (id, done) => {
    const user = await User.findById(id);
    done(null, user);
});
