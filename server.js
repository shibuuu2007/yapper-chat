const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const { Client } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
// 1. IMPORT GEMINI
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// --- CONFIGURATION ---
// Access the Key from Render's Environment Variables
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

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

// --- ROUTES ---
app.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
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
const connectedUsers = {}; 

io.on('connection', (socket) => {
  
  // 1. Join Room
  socket.on('join_room', ({ username, room }) => {
    socket.join(room);
    connectedUsers[socket.id] = { username, room };

    socket.emit('system_message', `You joined Room: ${room}`);
    socket.to(room).emit('system_message', `${username} has joined.`);
    
    // Send updated list (includes Gemini)
    io.to(room).emit('room_users', getUsersInRoom(room));
  });

  // 2. Leave Room
  socket.on('leave_room', () => {
    const user = connectedUsers[socket.id];
    if (user) {
        const { room, username } = user;
        socket.leave(room);
        delete connectedUsers[socket.id];
        
        io.to(room).emit('system_message', `${username} left.`);
        io.to(room).emit('room_users', getUsersInRoom(room));
    }
  });

  // 3. Chat Message + AI Logic
  socket.on('chat message', async (data) => {
    const user = connectedUsers[socket.id];
    if (user) {
      // Send User's message first
      io.to(user.room).emit('chat message', data);

      // Check for Gemini trigger
      const cleanMsg = data.text.trim(); 
      if (cleanMsg.toLowerCase().startsWith("gemini ")) {
          
          const prompt = cleanMsg.substring(7); // Remove "gemini "

          try {
              const result = await model.generateContent(prompt);
              const response = result.response;
              const aiText = response.text();

              io.to(user.room).emit('chat message', {
                  user: "Gemini", 
                  text: aiText
              });

          } catch (error) {
              console.error("Gemini Error:", error);
              io.to(user.room).emit('chat message', {
                  user: "Gemini",
                  text: "I am having trouble thinking right now. Try again later!"
              });
          }
      }
    }
  });

  // 4. Disconnect
  socket.on('disconnect', () => {
    const user = connectedUsers[socket.id];
    if (user) {
      const { room, username } = user;
      delete connectedUsers[socket.id];
      io.to(room).emit('system_message', `${username} left.`);
      io.to(room).emit('room_users', getUsersInRoom(room));
    }
  });
});

// --- HELPER: GET USERS ---
function getUsersInRoom(room) {
  const users = [];
  for (const id in connectedUsers) {
    if (connectedUsers[id].room === room) {
      users.push(connectedUsers[id].username);
    }
  }
  // Remove duplicates
  const uniqueUsers = [...new Set(users)];
  
  // FIX: Always put 'Gemini' at the start of the list
  return ['Gemini', ...uniqueUsers]; 
}

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on ${port}`));