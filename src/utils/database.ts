import mongoose from 'mongoose';

export class DatabaseService {
    private static instance: DatabaseService;
    private connectionString: string;

    private constructor() {
        this.connectionString = process.env.MONGODB_URI || 'mongodb://localhost:27017/diary';
    }

    public static getInstance(): DatabaseService {
        if (!DatabaseService.instance) {
            DatabaseService.instance = new DatabaseService();
        }
        return DatabaseService.instance;
    }

    public async connect(): Promise<void> {
        try {
            await mongoose.connect(this.connectionString);
            console.log('Connected to MongoDB successfully');
        } catch (error) {
            console.error('Failed to connect to MongoDB:', error);
            throw error;
        }
    }

    public async disconnect(): Promise<void> {
        try {
            await mongoose.disconnect();
            console.log('Disconnected from MongoDB');
        } catch (error) {
            console.error('Failed to disconnect from MongoDB:', error);
            throw error;
        }
    }

    public getConnectionStatus(): string {
        const states = {
            0: 'disconnected',
            1: 'connected',
            2: 'connecting',
            3: 'disconnecting'
        };
        return states[mongoose.connection.readyState as keyof typeof states] || 'unknown';
    }
}
