const { Pool } = require('pg');

// 连接数据库
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'webgis',
    password: '050200',
    port: 5432,
});

// 添加标记点
const addMarker = async ({ name, type, imageUrl, description, lat, lng, userId }) => {
    const query = `
        INSERT INTO markers (name, type, description, image_url, lat, lng, user_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING *;
    `;

    const values = [name, type, description, imageUrl, lat, lng, userId];
    try {
        const result = await pool.query(query, values);
        return result.rows[0]; // 返回插入的标记点信息
    } catch (error) {
        console.error('Error adding marker:', error);
        throw error;
    }
};

// 查询所有标记点
const getAllMarkers = async () => {
    const query = 'SELECT * FROM markers';
    try {
        const result = await pool.query(query);
        return result.rows;
    } catch (error) {
        console.error('Error fetching markers:', error);
        throw error;
    }
};

module.exports = {
    addMarker,
    getAllMarkers
};
