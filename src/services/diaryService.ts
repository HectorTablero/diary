import { Types } from 'mongoose';
import { DiaryEntry, Friend, Tag, User } from '../models';

export class DiaryService {
      /**
     * Get visible entries for a user based on priority durations
     */
    static async getVisibleEntries(userId: Types.ObjectId, date?: Date): Promise<any[]> {
        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');

        const currentDate = date || new Date();        const { priorityDurations } = user.settings;

        // Calculate visibility cutoff dates for each priority
        const cutoffDates = {
            1: new Date(currentDate.getTime() - priorityDurations[1] * 24 * 60 * 60 * 1000),
            2: new Date(currentDate.getTime() - priorityDurations[2] * 24 * 60 * 60 * 1000),
            3: new Date(currentDate.getTime() - priorityDurations[3] * 24 * 60 * 60 * 1000),
            4: new Date(currentDate.getTime() - priorityDurations[4] * 24 * 60 * 60 * 1000),
            5: new Date(currentDate.getTime() - priorityDurations[5] * 24 * 60 * 60 * 1000)
        };

        // Build query for visible entries
        const visibilityQuery = {
            user: userId,
            $or: [
                { priority: 1, date: { $gte: cutoffDates[1] } },
                { priority: 2, date: { $gte: cutoffDates[2] } },
                { priority: 3, date: { $gte: cutoffDates[3] } },
                { priority: 4, date: { $gte: cutoffDates[4] } },
                { priority: 5, date: { $gte: cutoffDates[5] } }
            ]
        };

        return await DiaryEntry.find(visibilityQuery)
            .populate('tags')
            .sort({ date: -1 });
    }
      /**
     * Get entries for a specific date
     */
    static async getEntriesForDate(userId: Types.ObjectId, targetDate: Date): Promise<any[]> {
        const user = await User.findById(userId);
        if (!user) throw new Error('User not found');

        // Create date range for the target day (start and end of day)
        const startOfDay = new Date(targetDate);
        startOfDay.setHours(0, 0, 0, 0);
        
        const endOfDay = new Date(targetDate);
        endOfDay.setHours(23, 59, 59, 999);

        const { priorityDurations } = user.settings;
        const currentDate = new Date();        // Calculate visibility cutoff dates for each priority
        const cutoffDates = {
            1: new Date(currentDate.getTime() - priorityDurations[1] * 24 * 60 * 60 * 1000),
            2: new Date(currentDate.getTime() - priorityDurations[2] * 24 * 60 * 60 * 1000),
            3: new Date(currentDate.getTime() - priorityDurations[3] * 24 * 60 * 60 * 1000),
            4: new Date(currentDate.getTime() - priorityDurations[4] * 24 * 60 * 60 * 1000),
            5: new Date(currentDate.getTime() - priorityDurations[5] * 24 * 60 * 60 * 1000)
        };

        // First, get parent entries on the specific date that are still visible
        const parentQuery = {
            user: userId,
            parentEntry: null, // Only top-level entries
            date: {
                $gte: startOfDay,
                $lte: endOfDay
            },
            $or: [
                { priority: 1, date: { $gte: cutoffDates[1] } },
                { priority: 2, date: { $gte: cutoffDates[2] } },
                { priority: 3, date: { $gte: cutoffDates[3] } },
                { priority: 4, date: { $gte: cutoffDates[4] } },
                { priority: 5, date: { $gte: cutoffDates[5] } }
            ]
        };

        const parentEntries = await DiaryEntry.find(parentQuery)
            .populate('tags')
            .sort({ date: -1 });

        // Get all parent entry IDs
        const parentEntryIds = parentEntries.map(entry => entry._id as Types.ObjectId);

        // Recursively get all sub-entries for these parent entries at any depth
        const allSubEntries = await this.getAllSubEntriesRecursively(userId, parentEntryIds, cutoffDates);

        // Combine all entries and build hierarchy on server side
        const allEntries = [...parentEntries, ...allSubEntries];
        
        // Build hierarchy and return only top-level entries with nested children
        return await Promise.all(
            parentEntries.map(parent => this.attachChildEntries(parent, allEntries))
        );
    }

    /**
     * Recursively get all sub-entries at any depth
     */
    private static async getAllSubEntriesRecursively(
        userId: Types.ObjectId, 
        parentIds: Types.ObjectId[], 
        cutoffDates: any
    ): Promise<any[]> {
        if (parentIds.length === 0) return [];        // Get direct children of the current parent IDs
        const subEntryQuery = {
            user: userId,
            parentEntry: { $in: parentIds },
            $or: [
                { priority: 1, date: { $gte: cutoffDates[1] } },
                { priority: 2, date: { $gte: cutoffDates[2] } },
                { priority: 3, date: { $gte: cutoffDates[3] } },
                { priority: 4, date: { $gte: cutoffDates[4] } },
                { priority: 5, date: { $gte: cutoffDates[5] } }
            ]
        };

        const directSubEntries = await DiaryEntry.find(subEntryQuery)
            .populate('tags')
            .sort({ date: -1 });

        if (directSubEntries.length === 0) return [];

        // Get IDs of these sub-entries to find their children
        const subEntryIds = directSubEntries.map(entry => entry._id as Types.ObjectId);

        // Recursively get children of these sub-entries
        const deeperSubEntries = await this.getAllSubEntriesRecursively(userId, subEntryIds, cutoffDates);

        return [...directSubEntries, ...deeperSubEntries];
    }

    /**
     * Get entries filtered for a specific friend
     */
    static async getEntriesForFriend(userId: Types.ObjectId, friendId: Types.ObjectId): Promise<any[]> {
        const friend = await Friend.findOne({ _id: friendId, user: userId }).populate('tags');
        if (!friend) throw new Error('Friend not found');

        // Get all visible entries first
        const visibleEntries = await this.getVisibleEntries(userId);

        // Filter entries that share at least one tag with the friend
        const friendTagIds = friend.tags.map((tag: any) => tag._id.toString());
        
        return visibleEntries.filter(entry => {
            // Check if entry shares any tags with friend
            const entryTagIds = entry.tags.map((tag: any) => tag._id.toString());
            const hasSharedTag = entryTagIds.some(tagId => friendTagIds.includes(tagId));
            
            // Check if entry is not hidden for this friend
            const isNotHidden = !friend.hiddenEntries.some(hiddenId => 
                hiddenId.toString() === entry._id.toString()
            );

            return hasSharedTag && isNotHidden;
        });
    }

    /**
     * Recursively attach child entries to a parent entry
     */
    private static async attachChildEntries(parentEntry: any, allEntries: any[]): Promise<any> {
        // Convert to plain object to allow adding properties
        const parentObj = parentEntry.toObject ? parentEntry.toObject() : { ...parentEntry };

        const childEntries = allEntries.filter(entry => 
            entry.parentEntry && entry.parentEntry.toString() === parentObj._id.toString()
        );

        if (childEntries.length > 0) {
            // Recursively get children of children
            parentObj.children = await Promise.all(
                childEntries.map(child => this.attachChildEntries(child, allEntries))
            );
        } else {
            parentObj.children = [];
        }

        return parentObj;
    }

    /**
     * Create a new diary entry
     */
    static async createEntry(data: {
        userId: Types.ObjectId;
        content: string;
        date?: Date;
        priority?: number;
        tagIds?: Types.ObjectId[];
        parentEntryId?: Types.ObjectId;
    }): Promise<any> {
        const entry = new DiaryEntry({
            user: data.userId,
            content: data.content,
            date: data.date || new Date(),
            priority: data.priority || 2,
            tags: data.tagIds || [],
            parentEntry: data.parentEntryId || null
        });        return await entry.save();
    }

    /**
     * Update user priority durations settings
     */
    static async updatePriorityDurations(
        userId: Types.ObjectId,
        durations: { 1: number; 2: number; 3: number; 4: number; 5: number }
    ): Promise<any> {
        return await User.findByIdAndUpdate(
            userId,
            { 'settings.priorityDurations': durations },
            { new: true }
        );
    }
}
