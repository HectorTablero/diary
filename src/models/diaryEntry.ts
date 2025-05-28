import { Schema, model, Document, Types } from "mongoose";

interface DiaryEntryDocument extends Document {
    user: Types.ObjectId;
    content: string;
    date: Date;
    priority: number; // 1-5 (1 = highest relevance, 5 = lowest)
    tags: Types.ObjectId[];
    parentEntry?: Types.ObjectId; // Null for top-level entries
    createdAt: Date;
    updatedAt: Date;
}

const diaryEntrySchema = new Schema({
    user: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    content: { 
        type: String, 
        required: true,
        trim: true
    },
    date: { 
        type: Date, 
        required: true,
        default: Date.now
    },    priority: { 
        type: Number, 
        required: true,
        min: 1,
        max: 5,
        default: 3 // Moderate relevance
    },
    tags: [{ 
        type: Schema.Types.ObjectId, 
        ref: 'Tag' 
    }],
    parentEntry: { 
        type: Schema.Types.ObjectId, 
        ref: 'DiaryEntry',
        default: null 
    }
}, {
    timestamps: true
});

// Index for efficient queries
diaryEntrySchema.index({ user: 1, date: -1 });
diaryEntrySchema.index({ user: 1, parentEntry: 1 });
diaryEntrySchema.index({ user: 1, tags: 1 });

// Virtual for checking if entry is visible based on priority duration
diaryEntrySchema.virtual('isVisible').get(function(this: DiaryEntryDocument) {
    // This will be calculated in the application logic with user settings
    return true; // Placeholder
});

// Method to get all child entries
diaryEntrySchema.methods.getChildEntries = function() {
    return this.model('DiaryEntry').find({ parentEntry: this._id });
};

export const DiaryEntry = model<DiaryEntryDocument>("DiaryEntry", diaryEntrySchema);
