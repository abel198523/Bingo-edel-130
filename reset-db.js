const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function resetDatabase() {
    const client = await pool.connect();
    try {
        console.log('Starting database reset...');
        
        // Disable triggers to avoid foreign key issues during truncation if needed, 
        // but DROP TABLE is cleaner for a full reset
        await client.query(`
            DROP TABLE IF EXISTS broadcasts CASCADE;
            DROP TABLE IF EXISTS referrals CASCADE;
            DROP TABLE IF EXISTS transactions CASCADE;
            DROP TABLE IF EXISTS game_participants CASCADE;
            DROP TABLE IF EXISTS games CASCADE;
            DROP TABLE IF EXISTS wallets CASCADE;
            DROP TABLE IF EXISTS deposits CASCADE;
            DROP TABLE IF EXISTS withdrawals CASCADE;
            DROP TABLE IF EXISTS admin_users CASCADE;
            DROP TABLE IF EXISTS users CASCADE;
        `);
        
        console.log('All tables dropped successfully.');
        console.log('The server will recreate them on next start.');
        
    } catch (err) {
        console.error('Error resetting database:', err);
    } finally {
        client.release();
        await pool.end();
        process.exit(0);
    }
}

resetDatabase();
