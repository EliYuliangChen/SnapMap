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

const JWT_SECRET = 'stop_attacking_my_website';

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

// 验证token的中间件
const verifyToken = (req, res, next) => {
    const token = req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.status(401).json({ message: '未提供token' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ message: 'token无效' });
        }
        req.user = decoded;
        next();
    });
};

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

app.post('/update-avatar', verifyToken, async (req, res) => {
    const { userId, newAvatar } = req.body;

    try {
        // 获取用户信息
        const user = await getUserById(userId);
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }

        // 确定旧头像路径
        const oldAvatarUrl = user.avatar_url;
        console.log('old: ' + oldAvatarUrl)
        console.log('new:' + newAvatar)

        // 新的头像路径
        let avatarUrl = '/uploads/default_avatar.png';

        if (newAvatar) {
            const tempPath = path.join(__dirname, '..', 'upload', 'temp', newAvatar);
            const avatarPath = path.join(__dirname, '..', 'upload', 'avatar');
            if (!fs.existsSync(avatarPath)) {
                fs.mkdirSync(avatarPath, { recursive: true });
            }
            const finalPath = path.join(avatarPath, newAvatar);

            if (fs.existsSync(tempPath)) {
                // 将临时头像文件移动到avatar文件夹
                fs.renameSync(tempPath, finalPath);
                avatarUrl = `/uploads/avatar/${newAvatar}`;
                console.log('Transfer file success!')
            } else {
                console.log(`Temp file ${tempPath} does not exist.`);
                return res.status(400).json({ message: '临时文件不存在' });
            }

            // 清除定时删除任务
            if (fileTimers.has(newAvatar)) {
                clearTimeout(fileTimers.get(newAvatar));
                fileTimers.delete(newAvatar);
            }
        }

        // 删除旧头像文件
        if (oldAvatarUrl && oldAvatarUrl !== '/upload/default_avatar.png') {
            const oldAvatarPath = path.join(__dirname, '..', 'upload', 'avatar', path.basename(oldAvatarUrl));
            if (fs.existsSync(oldAvatarPath)) {
                fs.unlinkSync(oldAvatarPath);
                console.log(`Old avatar file ${oldAvatarPath} deleted.`);
            } else {
                console.log(`Old avatar file ${oldAvatarPath} does not exist.`);
            }
        }

        // 更新数据库中的头像URL
        await updateAvatarUrl(userId, avatarUrl);

        res.status(200).json({ message: '头像更新成功', avatarUrl });
    } catch (error) {
        console.error('Error updating avatar:', error);
        res.status(500).json({ message: '更新头像失败', error: error.message });
    }
});

app.post('/delete-temp-avatar', verifyToken, (req, res) => {
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

app.post('/delete-temp-avatar-unauth', handleDeleteTempAvatar);

// 抽取共同的处理逻辑
function handleDeleteTempAvatar(req, res) {
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
}

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

        const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1h' });

        console.log('用户验证成功,准备发送响应:', {
            message: '登录成功',
            token, // 返回JWT Token
            user: {
                id: user.id,
                username: user.username,
                avatarUrl: user.avatar_url,
            }
        });

        res.status(200).json({
            message: '登录成功',
            token, // 返回JWT Token
            user: {
                id: user.id,
                username: user.username,
                avatarUrl: user.avatar_url,
            }
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ message: '服务器错误', error: error.message });
    }
});

app.post('/api/update-username', verifyToken, async (req, res) => {
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

app.post('/api/change-password', verifyToken, async (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;

    if (!userId || !currentPassword || !newPassword) {
        return res.status(400).json({ message: '缺少必要的参数' });
    }

    try {
        const user = await getUserById(userId);

        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: '当前密码不正确' });
        }

        // 对新密码进行哈希处理
        const hashedNewPassword = await bcrypt.hash(newPassword, 10);

        await updatePassword(userId, newPassword);
        console.log('测试用 - 用户更改后的密码:', newPassword);
        res.status(200).json({ success: true, message: '密码更新成功' });
    } catch (error) {
        console.error('Error changing password:', error);
        res.status(500).json({ message: '更改密码失败', error: error.message });
    }
});
// app.post('/upload-avatar', upload.single('file'), (req, res) => {
//     try {
//         if (!req.file) {
//             return res.status(400).json({ message: 'No file uploaded' });
//         }
//
//         const tempAvatarUrl = `/uploads/temp/${req.file.filename}`;
//         const tempFilePath = path.join(__dirname, '..', 'upload', 'temp', req.file.filename);
//
//         console.log('File path on server:', tempFilePath);
//
//         // 用于删除临时文件的计时器
//         const timer = setTimeout(() => {
//             if (fs.existsSync(tempFilePath)) {
//                 fs.unlinkSync(tempFilePath);
//                 console.log(`Temp file ${tempFilePath} deleted after timeout.`);
//
//                 // 通知所有连接的客户端
//                 clients.forEach(client => {
//                     if (client.readyState === WebSocket.OPEN) {
//                         client.send(JSON.stringify({ type: 'FILE_DELETED', filename: req.file.filename }));
//                     }
//                 });
//             }
//         }, 30 * 1000); // 30 秒后删除
//
//         fileTimers.set(req.file.filename, timer);
//
//         console.log('File uploaded to:', tempAvatarUrl);
//
//         // 返回正确的文件路径
//         res.status(200).json({ tempAvatarUrl });
//     } catch (error) {
//         console.error('Error during file upload:', error);
//         res.status(500).json({ message: 'File upload failed', error: error.message });
//     }
// });


app.get('/api/user/profile', verifyToken, async (req, res) => {
    const userId = req.params.userId;
    try {
        const userId = req.user.id;  // 确保从 token 解码后的用户 ID 是一个整数
        console.log('从 token 中获取到的 userId:', userId);  // 打印 userId
        const user = await getUserById(userId);
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
