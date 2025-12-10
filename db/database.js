const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

pool.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
    console.error('Database connection error:', err);
});

async function initializeDatabase() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50),
                telegram_id BIGINT UNIQUE,
                phone_number VARCHAR(20),
                password_hash VARCHAR(255),
                is_registered BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                is_active BOOLEAN DEFAULT true
            );

            CREATE TABLE IF NOT EXISTS wallets (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                balance DECIMAL(10, 2) DEFAULT 0.00,
                currency VARCHAR(10) DEFAULT 'ETB',
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id)
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                type VARCHAR(20) NOT NULL,
                amount DECIMAL(10, 2) NOT NULL,
                balance_before DECIMAL(10, 2),
                balance_after DECIMAL(10, 2),
                description TEXT,
                game_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS games (
                id SERIAL PRIMARY KEY,
                stake_amount DECIMAL(10, 2) NOT NULL,
                status VARCHAR(20) DEFAULT 'active',
                winner_id INTEGER REFERENCES users(id),
                winning_card INTEGER,
                called_numbers INTEGER[],
                total_pot DECIMAL(10, 2) DEFAULT 0.00,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS game_participants (
                id SERIAL PRIMARY KEY,
                game_id INTEGER REFERENCES games(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                card_id INTEGER NOT NULL,
                stake_amount DECIMAL(10, 2) NOT NULL,
                is_winner BOOLEAN DEFAULT false,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(game_id, user_id)
            );
        `);
        console.log('Database tables initialized');
    } catch (err) {
        console.error('Error initializing database:', err);
    } finally {
        client.release();
    }
}

module.exports = {
    pool,
    initializeDatabase,
    query: (text, params) => pool.query(text, params)
};