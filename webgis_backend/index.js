const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { addUser, getUserByEmail } = require('./models/userModel');

const app = express();
const port = 3000;

// 中间件配置
app.use(cors());
app.use(bodyParser.json());

// 设置静态文件路径，以便可以通过URL访问上传的文件
app.use('/uploads', express.static(path.join(__dirname, '..', 'upload')));
app.use('/public', express.static(path.join(__dirname, 'public')));

// 配置 multer 存储选项
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        let uploadPath = path.join(__dirname, '..', 'upload');

        if (req.path === '/upload-avatar') {
            uploadPath = path.join(uploadPath, 'avatar');
        } else if (req.path === '/upload-location') {
            uploadPath = path.join(uploadPath, 'location');
        }

        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// 示例路由
app.get('/', (req, res) => {
    res.send('Hello World!');
});

// 注册路由
app.post('/register', upload.none(), async (req, res) => {
    const { email, username, password, avatar } = req.body;
    let avatarUrl = avatar;

    // 如果 avatar 为空，表示没有上传自定义头像，则使用后端的默认头像路径
    if (!avatarUrl || avatarUrl === '') {
        avatarUrl = '/public/default_avatar.png'; // 后端默认头像路径
    }

    console.log('Register data:', email, username, password, avatarUrl);

    try {
        const user = await addUser(email, username, password, avatarUrl);
        console.log('User added:', user);
        res.status(201).json({ message: 'User registered successfully!', user });
    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Error registering user', error });
    }
});

// 登录路由
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 从数据库中查找用户
        const user = await getUserByEmail(email);

        if (!user) {
            return res.status(400).json({ message: '用户不存在' });
        }

        // 验证密码是否正确
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: '密码错误' });
        }

        // 生成JWT令牌（可选）
        const token = jwt.sign({ id: user.id }, '你的密钥', { expiresIn: '1h' });

        // 返回成功消息
        res.status(200).json({ message: '登录成功', token: token });
    } catch (error) {
        console.error('登录错误:', error);
        res.status(500).json({ message: '服务器错误', error });
    }
});

// 上传头像路由
app.post('/upload-avatar', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    const avatarUrl = `/uploads/avatar/${req.file.filename}`;
    res.status(200).json({ avatarUrl });
});

// 上传地点图片路由
app.post('/upload-location', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    const locationImageUrl = `/uploads/location/${req.file.filename}`;
    res.status(200).json({ locationImageUrl });
});

// 服务器启动
app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
