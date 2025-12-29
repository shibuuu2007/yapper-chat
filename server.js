const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- CLOUD DB CONNECTION ---
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

db.connect()
  .then(() => console.log('Connected to Neon Cloud DB'))
  .catch(err => console.error('DB Connection Error:', err));

// --- SETUP STORAGE (MEMORY) ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.static(__dirname));
app.use(express.json());

// --- ROUTES ---

app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  
  // --- UPDATED DEFAULTS ---
  // Now using your local asset files instead of code!
  const defaultPic = "assets/user.png"; 
  const defaultWallpaper = "assets/background.png"; 

  try {
    await db.query(
      `INSERT INTO users (username, password, wallpaper, profile_pic) VALUES ($1, $2, $3, $4)`, 
      [username, hash, defaultWallpaper, defaultPic]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Username taken!" });
  }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  
  try {
    const result = await db.query(`SELECT * FROM users WHERE username = $1`, [username]);
    const user = result.rows[0];

    if (!user) return res.json({ success: false, message: "User not found" });
    
    if (bcrypt.compareSync(password, user.password)) {
      res.json({ 
        success: true, 
        username: user.username, 
        wallpaper: user.wallpaper,
        profile_pic: user.profile_pic 
      });
    } else {
      res.json({ success: false, message: "Wrong password" });
    }
  } catch (err) {
    res.json({ success: false, message: "Login Error" });
  }
});

// Wallpaper Route
app.post('/upload-wallpaper-image', upload.single('wallpaper'), async (req, res) => {
  if (!req.file) return res.json({ success: false });
  const username = req.body.username;
  const imageString = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.query(`UPDATE users SET wallpaper = $1 WHERE username = $2`, [imageString, username]);
  res.json({ success: true, url: imageString });
});

// Profile Pic Route
app.post('/upload-profile-pic', upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.json({ success: false });

  const username = req.body.username;
  const imageString = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

  await db.query(`UPDATE users SET profile_pic = $1 WHERE username = $2`, [imageString, username]);
  res.json({ success: true, url: imageString });
});

// --- CHAT SYSTEM ---
io.on('connection', (socket) => {
  socket.on('chat message', (data) => {
    io.emit('chat message', data);
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});