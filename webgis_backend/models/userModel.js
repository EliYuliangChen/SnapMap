const { Pool } = require('pg');
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'webgis',
    password: '050200',
    port: 5432,
});

const createUserTable = async () => {
    const queryText = `
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            email VARCHAR(255) UNIQUE NOT NULL,
            username VARCHAR(255) UNIQUE NOT NULL,
            password VARCHAR(255) NOT NULL,
            avatar_url VARCHAR(255) DEFAULT '/default_avatar.png',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
    `;
    try {
        await pool.query(queryText);
        console.log('Users table created successfully');
    } catch (err) {
        console.error('Error creating users table', err);
    }
};

const bcrypt = require('bcrypt');
const saltRounds = 10;

const addUser = async (email, username, password, avatarUrl) => {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const queryText = `
        INSERT INTO users (email, username, password, avatar_url)
        VALUES ($1, $2, $3, $4)
        RETURNING *;
    `;
    const values = [email, username, hashedPassword, avatarUrl];
    try {
        const res = await pool.query(queryText, values);
        console.log('User added to database:', res.rows[0]);
        return res.rows[0];
    } catch (err) {
        console.error('Error adding user', err);
        throw err;
    }
};

const getUserByEmail = async (email) => {
    const queryText = `
        SELECT * FROM users WHERE email = $1;
    `;
    try {
        const res = await pool.query(queryText, [email]);
        return res.rows[0]; // 返回用户信息（如果存在）
    } catch (err) {
        console.error('Error fetching user by email', err);
        throw err;
    }
};

const getUserByUsername = async (username) => {
    const queryText = `
        SELECT * FROM users WHERE username = $1;
    `;
    try {
        const res = await pool.query(queryText, [username]);
        return res.rows[0]; // 返回用户信息（如果存在）
    } catch (err) {
        console.error('Error fetching user by username', err);
        throw err;
    }
};

module.exports = {
    createUserTable,
    addUser,
    getUserByEmail,
    getUserByUsername,
};
