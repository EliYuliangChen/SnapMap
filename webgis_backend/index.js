const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {
    addUser,
    getUserByEmail,
    getUserByUsername,
    updateUsername,
    updatePassword,
    updateAvatarUrl,
    getUserById,
    getSecurityQuestionByEmail,
    checkSecurityAnswer
} = require('./models/userModel');

const { addMarker, getAllMarkers } = require('./models/markerModel');

const WebSocket = require('ws');
const http = require('http');

const app = express();
const port = 3000;

const JWT_SECRET = 'stop_attacking_my_website';

app.use(cors({
    origin: 'http://192.168.68.103:8080',  // 你的前端URL
    credentials: true
}));
app.use(bodyParser.json());

// 设置静态文件路径
app.use('/uploads', (req, res, next) => {
    console.log('Requested file:', req.url);
    next();
}, express.static(path.join(__dirname, '..', 'upload')));

// 配置 multer 存储选项
// const tempStorage = multer.diskStorage({
//     destination: function (req, file, cb) {
//         const tempPath = path.join(__dirname, '..', 'upload', 'temp');
//         if (!fs.existsSync(tempPath)) {
//             fs.mkdirSync(tempPath, { recursive: true });
//         }
//         cb(null, tempPath);
//     },
//     filename: function (req, file, cb) {
//         cb(null, Date.now() + path.extname(file.originalname));
//     }
// });

const avatarStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const avatarPath = path.join(__dirname, '..', 'upload', 'avatar');
        if (!fs.existsSync(avatarPath)) {
            fs.mkdirSync(avatarPath, { recursive: true });
        }
        cb(null, avatarPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: avatarStorage });
// const upload = multer({ storage: tempStorage });

const markerStorage = multer.diskStorage({
    destination: function (req, file, cb) {
        const markerPath = path.join(__dirname, '..', 'upload', 'location'); // 上传到 location 文件夹
        if (!fs.existsSync(markerPath)) {
            fs.mkdirSync(markerPath, { recursive: true });
        }
        cb(null, markerPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname)); // 使用当前时间戳加文件扩展名命名文件
    }
});

const uploadMarker = multer({ storage: markerStorage });

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

app.post('/update-avatar', verifyToken, upload.single('avatar'), async (req, res) => {
    const userId = req.body.userId;

    try {
        const user = await getUserById(userId);
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }

        let avatarUrl = user.avatar_url; // 默认保持原来的头像

        if (req.file) {
            // 新头像文件路径
            avatarUrl = `/uploads/avatar/${req.file.filename}`;

            // 删除旧头像文件（如果不是默认头像）
            if (user.avatar_url && user.avatar_url !== '/uploads/default_avatar.png') {
                console.log('Old avatar URL:', user.avatar_url);
                const oldAvatarPath = path.join(__dirname, '..', 'upload', 'avatar', path.basename(user.avatar_url)); // 只使用文件名
                console.log('Attempting to delete old avatar from:', oldAvatarPath);
                if (fs.existsSync(oldAvatarPath)) {
                    fs.unlinkSync(oldAvatarPath);
                    console.log(`Deleted old avatar: ${oldAvatarPath}`);
                } else {
                    console.log(`Old avatar file does not exist: ${oldAvatarPath}`);
                }
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

app.post('/register', upload.single('avatar'), async (req, res) => {
    const { email, username, password, securityQuestion, securityAnswer } = req.body;

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

        if (req.file) {
            avatarUrl = `/uploads/avatar/${req.file.filename}`;
        }

        const user = await addUser(email, username, password, avatarUrl, securityQuestion, securityAnswer);
        res.status(201).json({ message: 'User registered successfully!', user });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Error registering user', error: error.message });

        // 如果注册失败，删除已上传的头像文件
        if (req.file) {
            fs.unlinkSync(req.file.path);
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

// 检查邮箱是否存在，并返回安全问题
app.post('/api/check-email', async (req, res) => {
    const { email } = req.body;
    try {
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(404).json({ exists: false, message: '用户不存在' });
        }
        const securityQuestion = await getSecurityQuestionByEmail(email);
        res.status(200).json({ exists: true, securityQuestion: securityQuestion.security_question });
    } catch (error) {
        console.error('Error checking email:', error);
        res.status(500).json({ message: '服务器错误' });
    }
});

// 验证安全问题答案
app.post('/api/check-answer', async (req, res) => {
    const { email, answer } = req.body;
    try {
        const isCorrect = await checkSecurityAnswer(email, answer);
        if (isCorrect) {
            res.status(200).json({ correct: true });
        } else {
            res.status(400).json({ correct: false, message: '安全问题答案错误' });
        }
    } catch (error) {
        console.error('Error checking security answer:', error);
        res.status(500).json({ message: '服务器错误' });
    }
});

// 重置密码
app.post('/api/reset-password', async (req, res) => {
    const { email, newPassword } = req.body;
    try {
        const user = await getUserByEmail(email);
        if (!user) {
            return res.status(404).json({ message: '用户不存在' });
        }

        // 更新密码
        await updatePassword(user.id, newPassword);
        res.status(200).json({ success: true, message: '密码重置成功' });
    } catch (error) {
        console.error('Error resetting password:', error);
        res.status(500).json({ message: '服务器错误' });
    }
});

app.post('/api/markers', verifyToken, uploadMarker.single('image'), async (req, res) => {
    const { name, type, description, lat, lng } = req.body;
    const userId = req.user.id;
    const imageUrl = req.file ? `/uploads/location/${req.file.filename}` : null;

    try {
        const newMarker = await addMarker({ name, type, description, imageUrl, lat, lng, userId });
        res.status(201).json({ message: '标记点添加成功', newMarker });
    } catch (error) {
        res.status(500).json({ message: '标记点创建失败', error: error.message });
    }
});

server.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
