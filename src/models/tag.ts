import { Schema, model, Document, Types, Model } from "mongoose";

interface TagDocument extends Document {
    user: Types.ObjectId;
    name: string;
    color: string; // Hex code (e.g., "#4ECDC4")
    createdAt: Date;
    updatedAt: Date;
    // Method signatures
    getEntries(): any;
    getFriends(): any;
}

interface TagModel extends Model<TagDocument> {
    getDefaultColors(): string[];
}

const tagSchema = new Schema({
    user: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    name: { 
        type: String, 
        required: true,
        trim: true,
        maxlength: 50
    },
    color: { 
        type: String, 
        required: true,
        validate: {
            validator: function(v: string) {
                // Validate hex color format
                return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(v);
            },
            message: 'Color must be a valid hex color code (e.g., #4ECDC4 or #fff)'
        },
        default: '#4ECDC4'
    }
}, {
    timestamps: true
});

// Ensure unique tag names per user
tagSchema.index({ user: 1, name: 1 }, { unique: true });

// Static method to get default colors for new tags
tagSchema.statics.getDefaultColors = function() {
    return [
        '#4ECDC4', // Teal
        '#45B7D1', // Blue  
        '#96CEB4', // Green
        '#FFEAA7', // Yellow
        '#DDA0DD', // Plum
        '#98D8C8', // Mint
        '#F7DC6F', // Light Yellow
        '#BB8FCE', // Light Purple
        '#85C1E9', // Light Blue
        '#F8C471'  // Light Orange
    ];
};

// Method to get entries using this tag
tagSchema.methods.getEntries = function() {
    return this.model('DiaryEntry').find({ tags: this._id });
};

// Method to get friends using this tag
tagSchema.methods.getFriends = function() {
    return this.model('Friend').find({ tags: this._id });
};

export const Tag = model<TagDocument, TagModel>("Tag", tagSchema);
