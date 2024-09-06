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
            security_question VARCHAR(255),
            security_answer VARCHAR(255),
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

const addUser = async (email, username, password, avatarUrl, securityQuestion, securityAnswer) => {
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    const queryText = `
    INSERT INTO users (email, username, password, avatar_url, security_question, security_answer)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING *;
  `;
    const values = [email, username, hashedPassword, avatarUrl, securityQuestion, securityAnswer];
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

const updateUsername = async (userId, newUsername) => {
    const queryText = `
        UPDATE users
        SET username = $1
        WHERE id = $2
            RETURNING *;
    `;
    try {
        const res = await pool.query(queryText, [newUsername, userId]);
        if (res.rows.length === 0) {
            throw new Error('User not found');
        }
        console.log('User updated in database:', res.rows[0]);
        return res.rows[0];
    } catch (err) {
        console.error('Error updating username', err);
        throw err;
    }
};

const updatePassword = async (userId, newPassword) => {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    const queryText = `
        UPDATE users
        SET password = $1
        WHERE id = $2
        RETURNING *;
    `;
    try {
        const res = await pool.query(queryText, [hashedPassword, userId]);
        return res.rows[0];
    } catch (err) {
        console.error('Error updating password', err);
        throw err;
    }
};

const updateAvatarUrl = async (userId, avatarUrl) => {
    const queryText = `
        UPDATE users
        SET avatar_url = $1
        WHERE id = $2
        RETURNING *;
    `;
    try {
        const res = await pool.query(queryText, [avatarUrl, userId]);
        return res.rows[0];
    } catch (err) {
        console.error('Error updating avatar URL', err);
        throw err;
    }
};

const getUserById = async (id) => {
    const queryText = `
        SELECT * FROM users WHERE id = $1;
    `;
    try {
        const res = await pool.query(queryText, [id]);
        return res.rows[0];
    } catch (err) {
        console.error('Error fetching user by id', err);
        throw err;
    }
};

// 获取用户的安全问题
const getSecurityQuestionByEmail = async (email) => {
    const queryText = `
        SELECT security_question FROM users WHERE email = $1;
    `;
    try {
        const res = await pool.query(queryText, [email]);
        return res.rows[0]; // 返回安全问题
    } catch (err) {
        console.error('Error fetching security question by email', err);
        throw err;
    }
};

// 验证安全问题答案
const checkSecurityAnswer = async (email, answer) => {
    const queryText = `
        SELECT security_answer FROM users WHERE email = $1;
    `;
    try {
        const res = await pool.query(queryText, [email]);
        if (res.rows.length === 0) {
            return false; // 如果用户不存在
        }
        return res.rows[0].security_answer === answer; // 返回答案是否匹配
    } catch (err) {
        console.error('Error checking security answer', err);
        throw err;
    }
};

module.exports = {
    createUserTable,
    addUser,
    getUserByEmail,
    getUserByUsername,
    updateUsername,
    updatePassword,
    updateAvatarUrl,
    getUserById,
    getSecurityQuestionByEmail,  // 新增
    checkSecurityAnswer  // 新增
};
