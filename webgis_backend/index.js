const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { addUser, getUserByEmail, getUserByUsername, updateUsername, updatePassword, updateAvatarUrl, getUserById } = require('./models/userModel');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const port = 3000;

app.use(cors({
    origin: 'http://localhost:8080',  // 你的前端URL
    credentials: true
}));
app.use(bodyParser.json());

// 设置静态文件路径
app.use('/uploads', (req, res, next) => {
    console.log('Requested file:', req.url);
    next();
}, express.static(path.join(__dirname, '..', 'upload')));

// 配置 multer 存储选项
const tempStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const tempPath = path.join(__dirname, '..', 'upload', 'temp');
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true });
        }
        cb(null, tempPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: tempStorage });

// 用于存储上传文件的定时器
const fileTimers = new Map();

// 创建 HTTP 服务器
const server = http.createServer(app);

// 创建 WebSocket 服务器
const wss = new WebSocket.Server({ server });

// 存储 WebSocket 连接
const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
});

app.post('/upload-avatar', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }

        const tempAvatarUrl = `/uploads/temp/${req.file.filename}`;
        const tempFilePath = path.join(__dirname, '..', 'upload', 'temp', req.file.filename);

        console.log('File path on server:', tempFilePath);

        const timer = setTimeout(() => {
            if (fs.existsSync(tempFilePath)) {
                fs.unlinkSync(tempFilePath);
                console.log(`Temp file ${tempFilePath} deleted after timeout.`);

                // 通知所有连接的客户端
                clients.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) {
                        client.send(JSON.stringify({ type: 'FILE_DELETED', filename: req.file.filename }));
                    }
                });
            }
        }, 30 * 1000); // 30 秒后删除

        fileTimers.set(req.file.filename, timer);

        console.log('File uploaded to:', tempAvatarUrl);

        res.status(200).json({ tempAvatarUrl });
    } catch (error) {
        console.error('Error during file upload:', error);
        res.status(500).json({ message: 'File upload failed', error: error.message });
    }
});

app.post('/delete-temp-avatar', (req, res) => {
    const { tempAvatarUrl } = req.body;
    if (!tempAvatarUrl) {
        return res.status(400).json({ message: 'No tempAvatarUrl provided' });
    }

    const tempFileName = path.basename(tempAvatarUrl);
    const tempFilePath = path.join(__dirname, '..', 'upload', 'temp', tempFileName);

    console.log('Attempting to delete:', tempFilePath);

    if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
        console.log(`Temp file ${tempFilePath} deleted.`);
    } else {
        console.log(`File ${tempFilePath} does not exist.`);
    }

    if (fileTimers.has(tempFileName)) {
        clearTimeout(fileTimers.get(tempFileName));
        fileTimers.delete(tempFileName);
    }

    res.status(200).json({ message: 'Temp avatar deleted.' });
});

app.post('/register', upload.none(), async (req, res) => {
    const { email, username, password, avatar } = req.body;

    try {
        const existingUser = await getUserByEmail(email);
        if (existingUser) {
            return res.status(400).json({ message: 'Email already registered. Please log in.' });
        }

        const existingUsername = await getUserByUsername(username);
        if (existingUsername) {
            return res.status(400).json({ message: 'Username already taken. Please choose another.' });
        }

        let avatarUrl = '/uploads/default_avatar.png';

        if (avatar) {
            const tempPath = path.join(__dirname, '..', 'upload', 'temp', avatar);
            const avatarPath = path.join(__dirname, '..', 'upload', 'avatar');
            if (!fs.existsSync(avatarPath)) {
                fs.mkdirSync(avatarPath, { recursive: true });
            }
            const finalPath = path.join(avatarPath, avatar);

            if (fs.existsSync(tempPath)) {
                fs.renameSync(tempPath, finalPath);
                avatarUrl = `/uploads/avatar/${avatar}`;
            } else {
                console.log(`Temp file ${tempPath} does not exist.`);
            }

            if (fileTimers.has(avatar)) {
                clearTimeout(fileTimers.get(avatar));
                fileTimers.delete(avatar);
            }
        }

        const user = await addUser(email, username, password, avatarUrl);
        res.status(201).json({ message: 'User registered successfully!', user });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Error registering user', error: error.message });

        // 如果注册失败，删除可能已经移动的头像文件
        if (avatar) {
            const finalPath = path.join(__dirname, '..', 'upload', 'avatar', avatar);
            if (fs.existsSync(finalPath)) {
                fs.unlinkSync(finalPath);
            }
        }
    }
});

app.post('/login', async (req, res) => {
    console.log('收到登录请求:', req.body);
    const { email, password } = req.body;

    try {
        const user = await getUserByEmail(email);

        if (!user) {
            return res.status(400).json({ message: '用户不存在' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: '密码错误' });
        }
        console.log('用户验证成功,准备发送响应:', {
            message: '登录成功',
            id: user.id,
            avatarUrl: user.avatar_url,
            username: user.username
        });

        res.status(200).json({
            message: '登录成功',
            id: user.id,
            avatarUrl: user.avatar_url,
            username: user.username
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ message: '服务器错误', error: error.message });
    }
});

app.post('/api/update-username', async (req, res) => {
    const { userId, newUsername } = req.body;
    console.log('Received update username request:', { userId, newUsername });
    if (!userId || isNaN(parseInt(userId))) {
        return res.status(400).json({ message: '无效的用户ID' });
    }
    try {
        const existingUser = await getUserByUsername(newUsername);
        if (existingUser && existingUser.id !== parseInt(userId)) {
            console.log('Username already exists:', newUsername);
            return res.status(409).json({ message: '用户名已存在' });
        }
        const updatedUser = await updateUsername(parseInt(userId), newUsername);
        console.log('Username updated successfully:', updatedUser);
        res.status(200).json({ success: true, message: '用户名更新成功', user: updatedUser });
    } catch (error) {
        console.error('Error updating username:', error);
        res.status(500).json({ message: '更新用户名失败', error: error.message });
    }
});

app.post('/api/change-password', async (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;
    try {
        const user = await getUserById(userId);
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: '当前密码不正确' });
        }
        await updatePassword(userId, newPassword);
        res.status(200).json({ success: true, message: '密码更新成功' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ message: '更改密码失败', error: error.message });
    }
});

app.post('/api/upload-avatar', upload.single('avatar'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }

    const { userId } = req.body;
    const avatarUrl = `/uploads/avatar/${req.file.filename}`;

    try {
        await updateAvatarUrl(userId, avatarUrl);
        res.status(200).json({ success: true, avatarUrl: avatarUrl });
    } catch (error) {
        console.error('Error uploading avatar:', error);
        res.status(500).json({ message: '上传头像失败', error: error.message });
    }
});

app.get('/api/user/:userId', async (req, res) => {
    const userId = req.params.userId;
    try {
        const user = await getUserById(parseInt(userId));
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }
        res.json({
            id: user.id,
            username: user.username,
            email: user.email,
            avatarUrl: user.avatar_url
        });
    } catch (error) {
        console.error('Error fetching user:', error);
        res.status(500).json({ message: '获取用户信息失败', error: error.message });
    }
});

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
