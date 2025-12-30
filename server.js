const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- DATABASE ---
const db = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
db.connect().catch(err => console.error('DB Error:', err));

// --- STORAGE ---
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.static(__dirname));
app.use(express.json());

// --- AUTH ROUTES ---
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  // Default web-based assets
  const defaultPic = "https://cdn-icons-png.flaticon.com/512/847/847969.png"; 
  const defaultBg = "https://images.unsplash.com/photo-1534796636912-3b95b3ab5980?auto=format&fit=crop&w=1920&q=80"; 

  try {
    await db.query(`INSERT INTO users (username, password, wallpaper, profile_pic) VALUES ($1, $2, $3, $4)`, 
      [username, hash, defaultBg, defaultPic]);
    res.json({ success: true });
  } catch (err) { res.json({ success: false, message: "Username taken!" }); }
});

app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await db.query(`SELECT * FROM users WHERE username = $1`, [username]);
    const user = result.rows[0];
    if (user && bcrypt.compareSync(password, user.password)) {
      res.json({ success: true, username: user.username, wallpaper: user.wallpaper, profile_pic: user.profile_pic });
    } else { res.json({ success: false, message: "Invalid credentials" }); }
  } catch (err) { res.json({ success: false, message: "Error" }); }
});

// --- UPLOAD ROUTES ---
app.post('/upload-profile-pic', upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.json({ success: false });
  const img = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.query(`UPDATE users SET profile_pic = $1 WHERE username = $2`, [img, req.body.username]);
  res.json({ success: true, url: img });
});

app.post('/upload-wallpaper-image', upload.single('wallpaper'), async (req, res) => {
  if (!req.file) return res.json({ success: false });
  const img = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
  await db.query(`UPDATE users SET wallpaper = $1 WHERE username = $2`, [img, req.body.username]);
  res.json({ success: true, url: img });
});

// --- CHAT ROOM LOGIC ---
const connectedUsers = {}; // Tracks { socketId: { username, room } }

io.on('connection', (socket) => {
  
  // 1. Join Room Event
  socket.on('join_room', ({ username, room }) => {
    socket.join(room);
    
    // Track user
    connectedUsers[socket.id] = { username, room };

    // Tell ONLY the user they joined
    socket.emit('system_message', `You joined Room: ${room}`);
    
    // Tell EVERYONE else in the room
    socket.to(room).emit('system_message', `${username} has joined the chat.`);

    // Send updated User List to everyone in the room
    io.to(room).emit('room_users', getUsersInRoom(room));
  });

  // 2. Chat Message Event
  socket.on('chat message', (data) => {
    const user = connectedUsers[socket.id];
    if (user) {
      // Only send to people in the same room
      io.to(user.room).emit('chat message', data);
    }
  });

  // 3. Disconnect Event
  socket.on('disconnect', () => {
    const user = connectedUsers[socket.id];
    if (user) {
      const { room, username } = user;
      delete connectedUsers[socket.id]; // Remove from list
      
      // Notify room
      io.to(room).emit('system_message', `${username} left.`);
      io.to(room).emit('room_users', getUsersInRoom(room));
    }
  });
});

// Helper to get list of usernames in a specific room
function getUsersInRoom(room) {
  const users = [];
  for (const id in connectedUsers) {
    if (connectedUsers[id].room === room) {
      users.push(connectedUsers[id].username);
    }
  }
  return [...new Set(users)]; // Remove duplicates
}

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on ${port}`));