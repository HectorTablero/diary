import { Schema, model, Document } from "mongoose";

interface UserDocument extends Document {
    email: string;
    authProvider: string;
    providerId: string;
    settings: {
        priorityDurations: {
            1: number;
            2: number;
            3: number;
            4: number;
            5: number;
        };
    };
    // Legacy fields (keeping for backward compatibility)
    url?: string;
    name?: string;
    photo?: string;
}

const userSchema = new Schema({
    // New diary app fields
    email: { type: String, required: true, unique: true },
    authProvider: { type: String, required: true }, // 'google', 'github', etc.
    providerId: { type: String, required: true }, // OAuth provider's user ID
    settings: {
        priorityDurations: {
            1: { type: Number, default: 30 },
            2: { type: Number, default: 14 },
            3: { type: Number, default: 7 },
            4: { type: Number, default: 3 },
            5: { type: Number, default: 1 }
        }
    },
    // Legacy fields (optional for backward compatibility)
    url: { type: String, unique: true, sparse: true },
    name: { type: String },
    photo: {
        type: String,
        default: "https://i.pinimg.com/736x/2c/f5/58/2cf558ab8c1f12b43f7326945672805e.jpg"
    }
}, {
    timestamps: true
});

userSchema.pre("deleteOne", async function (next) {
    // Cleanup hook for when user is deleted
    // Currently no cleanup needed for diary entries as they should be preserved
    next();
});

export const User = model<UserDocument>("User", userSchema);
