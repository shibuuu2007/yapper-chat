const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Client } = require('pg'); // Using Postgres for Cloud
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// --- 1. CLOUD DATABASE CONNECTION ---
// We use the environment variable 'DATABASE_URL' which you will add in Render
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Connect to the database
db.connect()
  .then(() => console.log('Connected to Neon Cloud DB'))
  .catch(err => console.error('DB Connection Error:', err));

// Create Table (Stores images as TEXT now, not file paths)
db.query(`
  CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    wallpaper TEXT
  )
`);

// --- 2. SETUP STORAGE (MEMORY ONLY) ---
// Cloud servers delete files when they restart, so we process uploads in RAM.
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(express.static(__dirname));
app.use(express.json());

// --- 3. AUTH ROUTES ---
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  
  try {
    // Postgres uses $1, $2, $3 placeholders
    await db.query(
      `INSERT INTO users (username, password, wallpaper) VALUES ($1, $2, $3)`, 
      [username, hash, '#222222']
    );
    res.json({ success: true });
  } catch (err) {
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
      res.json({ success: true, username: user.username, wallpaper: user.wallpaper });
    } else {
      res.json({ success: false, message: "Wrong password" });
    }
  } catch (err) {
    console.error(err);
    res.json({ success: false, message: "Login Error" });
  }
});

// --- 4. WALLPAPER ROUTES ---

// Handle Color Update
app.post('/update-wallpaper-color', async (req, res) => {
  const { username, color } = req.body;
  await db.query(`UPDATE users SET wallpaper = $1 WHERE username = $2`, [color, username]);
  res.json({ success: true });
});

// Handle Image Upload (Converts Image to Base64 Text String)
app.post('/upload-wallpaper-image', upload.single('wallpaper'), async (req, res) => {
  if (!req.file) return res.json({ success: false });

  const username = req.body.username;
  // Convert the uploaded image buffer into a "Base64" text string
  const imageString = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

  await db.query(`UPDATE users SET wallpaper = $1 WHERE username = $2`, [imageString, username]);
  res.json({ success: true, url: imageString });
});

// --- 5. CHAT SYSTEM ---
io.on('connection', (socket) => {
  socket.on('chat message', (data) => {
    io.emit('chat message', data);
  });
});

// Use the PORT Render gives us
const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});