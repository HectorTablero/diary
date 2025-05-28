import { DatabaseSeeder } from './utils/seeder';

async function main() {
    try {
        const command = process.argv[2];
        
        if (command === 'seed') {
            await DatabaseSeeder.seedDatabase();
        } else if (command === 'clear') {
            await DatabaseSeeder.clearDatabase();
        } else if (command === 'reset') {
            await DatabaseSeeder.clearDatabase();
            await DatabaseSeeder.seedDatabase();
        } else {
            console.log('Usage: npm run seed [seed|clear|reset]');
            console.log('  seed  - Add sample data to the database');
            console.log('  clear - Remove all data from the database');
            console.log('  reset - Clear and then seed the database');
        }
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main();
