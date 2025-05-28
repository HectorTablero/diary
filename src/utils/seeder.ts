import { DatabaseService } from '../utils/database';
import { User, Tag, DiaryEntry, Friend } from '../models';

export class DatabaseSeeder {
    
    static async seedDatabase() {
        try {
            console.log('🌱 Starting database seeding...');
            
            // Connect to database
            const db = DatabaseService.getInstance();
            await db.connect();

            // Create sample user (if using OAuth, this would be created during auth)
            let sampleUser = await User.findOne({ email: 'sample@example.com' });
            if (!sampleUser) {
                sampleUser = new User({
                    email: 'sample@example.com',
                    authProvider: 'google',
                    providerId: 'sample-google-id',
                    settings: {
                        priorityDurations: {
                            1: 7,  // High priority: 7 days
                            2: 3,  // Medium priority: 3 days
                            3: 1   // Low priority: 1 day
                        }
                    }
                });
                await sampleUser.save();
                console.log('✅ Sample user created');
            }

            // Create sample tags
            const tagData = [
                { name: 'work', color: '#4ECDC4' },
                { name: 'personal', color: '#45B7D1' },
                { name: 'health', color: '#96CEB4' },
                { name: 'travel', color: '#FFEAA7' },
                { name: 'family', color: '#DDA0DD' },
                { name: 'hobbies', color: '#98D8C8' },
                { name: 'goals', color: '#F7DC6F' }            ];

            const tags: any[] = [];
            for (const tagInfo of tagData) {
                let tag = await Tag.findOne({ user: sampleUser._id, name: tagInfo.name });
                if (!tag) {
                    tag = new Tag({
                        user: sampleUser._id,
                        name: tagInfo.name,
                        color: tagInfo.color
                    });
                    await tag.save();
                }
                tags.push(tag);
            }
            console.log('✅ Sample tags created');

            // Create sample diary entries
            const today = new Date();
            const yesterday = new Date(today);
            yesterday.setDate(yesterday.getDate() - 1);
            const lastWeek = new Date(today);
            lastWeek.setDate(lastWeek.getDate() - 7);            const entryData = [
                {
                    content: 'Had a productive day at work. Finished the quarterly report and started planning the next project.',
                    date: today,
                    priority: 3,
                    tags: [tags.find(t => t.name === 'work')._id]
                },
                {
                    content: 'Went for a morning run. Feeling energized and ready for the day!',
                    date: yesterday,
                    priority: 4,
                    tags: [tags.find(t => t.name === 'health')._id, tags.find(t => t.name === 'personal')._id]
                },
                {
                    content: 'Family dinner was wonderful. Spent quality time with everyone and shared stories.',
                    date: yesterday,
                    priority: 2,
                    tags: [tags.find(t => t.name === 'family')._id, tags.find(t => t.name === 'personal')._id]
                },
                {
                    content: 'Working on my photography skills. Took some great shots in the park.',
                    date: lastWeek,
                    priority: 5,
                    tags: [tags.find(t => t.name === 'hobbies')._id]
                }
            ];

            for (const entryInfo of entryData) {
                const existingEntry = await DiaryEntry.findOne({
                    user: sampleUser._id,
                    content: entryInfo.content
                });
                
                if (!existingEntry) {
                    const entry = new DiaryEntry({
                        user: sampleUser._id,
                        content: entryInfo.content,
                        date: entryInfo.date,
                        priority: entryInfo.priority,
                        tags: entryInfo.tags
                    });
                    await entry.save();
                }
            }
            console.log('✅ Sample diary entries created');

            // Create sample friends
            const friendData = [
                {
                    name: 'John',
                    tags: [tags.find(t => t.name === 'work')._id, tags.find(t => t.name === 'personal')._id]
                },
                {
                    name: 'Sarah',
                    tags: [tags.find(t => t.name === 'family')._id, tags.find(t => t.name === 'personal')._id]
                },
                {
                    name: 'Mike',
                    tags: [tags.find(t => t.name === 'hobbies')._id, tags.find(t => t.name === 'travel')._id]
                }
            ];

            for (const friendInfo of friendData) {
                const existingFriend = await Friend.findOne({
                    user: sampleUser._id,
                    name: friendInfo.name
                });
                
                if (!existingFriend) {
                    const friend = new Friend({
                        user: sampleUser._id,
                        name: friendInfo.name,
                        tags: friendInfo.tags,
                        hiddenEntries: []
                    });
                    await friend.save();
                }
            }
            console.log('✅ Sample friends created');

            console.log('🎉 Database seeding completed successfully!');
            
        } catch (error) {
            console.error('❌ Error seeding database:', error);
            throw error;
        }
    }

    static async clearDatabase() {
        try {
            console.log('🧹 Clearing database...');
            
            await DiaryEntry.deleteMany({});
            await Friend.deleteMany({});
            await Tag.deleteMany({});
            await User.deleteMany({});
            
            console.log('✅ Database cleared');
        } catch (error) {
            console.error('❌ Error clearing database:', error);
            throw error;
        }
    }
}
