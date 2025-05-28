import { Schema, model, Document, Types } from "mongoose";

interface FriendDocument extends Document {
    user: Types.ObjectId;
    name: string;
    tags: Types.ObjectId[];
    hiddenEntries: Types.ObjectId[]; // Crossed-out but visible entries
    createdAt: Date;
    updatedAt: Date;
    // Method signatures
    isEntryVisible(entryId: Types.ObjectId): boolean;
    hideEntry(entryId: Types.ObjectId): Promise<FriendDocument>;
    unhideEntry(entryId: Types.ObjectId): Promise<FriendDocument>;
}

const friendSchema = new Schema({
    user: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    name: { 
        type: String, 
        required: true,
        trim: true,
        maxlength: 100
    },
    tags: [{ 
        type: Schema.Types.ObjectId, 
        ref: 'Tag' 
    }],
    hiddenEntries: [{ 
        type: Schema.Types.ObjectId, 
        ref: 'DiaryEntry' 
    }]
}, {
    timestamps: true
});

// Ensure unique friend names per user
friendSchema.index({ user: 1, name: 1 }, { unique: true });

// Method to check if an entry should be visible for this friend
friendSchema.methods.isEntryVisible = function(entryId: Types.ObjectId) {
    return !this.hiddenEntries.includes(entryId);
};

// Method to hide an entry for this friend
friendSchema.methods.hideEntry = function(entryId: Types.ObjectId) {
    if (!this.hiddenEntries.includes(entryId)) {
        this.hiddenEntries.push(entryId);
    }
    return this.save();
};

// Method to unhide an entry for this friend
friendSchema.methods.unhideEntry = function(entryId: Types.ObjectId) {
    this.hiddenEntries = this.hiddenEntries.filter(id => !id.equals(entryId));
    return this.save();
};

export const Friend = model<FriendDocument>("Friend", friendSchema);
