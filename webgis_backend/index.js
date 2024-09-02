const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { addUser, getUserByEmail } = require('./models/userModel');

const app = express();
const port = 3000;

app.use(cors());
app.use(bodyParser.json());

// 设置静态文件路径
app.use('/uploads', express.static(path.join(__dirname, '..', 'upload')));

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
            }
        }, 30 * 1000); // 5分钟后删除

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

        const token = jwt.sign({ id: user.id }, '你的密钥', { expiresIn: '1h' });

        res.status(200).json({
            message: '登录成功',
            token: token,
            avatarUrl: user.avatar_url,
            username: user.username
        });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ message: '服务器错误', error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
