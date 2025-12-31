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
// PUT YOUR API KEY HERE (In quotes!)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

// --- ROUTES (Login/Register/Uploads) ---
// (These are exactly the same as before)
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

// --- CHAT ROOM LOGIC WITH AI ---
const connectedUsers = {}; 

io.on('connection', (socket) => {
  
  socket.on('join_room', ({ username, room }) => {
    socket.join(room);
    connectedUsers[socket.id] = { username, room };
    socket.emit('system_message', `You joined Room: ${room}`);
    socket.to(room).emit('system_message', `${username} has joined.`);
    io.to(room).emit('room_users', getUsersInRoom(room));
  });

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

  // --- THE AI LOGIC IS HERE ---
  socket.on('chat message', async (data) => {
    const user = connectedUsers[socket.id];
    if (user) {
      // 1. Send the User's message to everyone normally
      io.to(user.room).emit('chat message', data);

      // 2. Check if they are calling Gemini
      const cleanMsg = data.text.trim(); // remove extra spaces
      if (cleanMsg.toLowerCase().startsWith("gemini ")) {
          
          // Extract the prompt (remove the word "gemini ")
          const prompt = cleanMsg.substring(7);

          try {
              // Ask Google AI
              const result = await model.generateContent(prompt);
              const response = result.response;
              const aiText = response.text();

              // Send the AI's reply back to the room
              io.to(user.room).emit('chat message', {
                  user: "Gemini", // The bot's name
                  text: aiText
              });

          } catch (error) {
              console.error(error);
              // Send error message if AI fails
              io.to(user.room).emit('chat message', {
                  user: "Gemini",
                  text: "I am having trouble thinking right now. Try again later!"
              });
          }
      }
    }
  });

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

function getUsersInRoom(room) {
  const users = [];
  for (const id in connectedUsers) {
    if (connectedUsers[id].room === room) users.push(connectedUsers[id].username);
  }
  return [...new Set(users)];
}

const port = process.env.PORT || 3000;
server.listen(port, () => console.log(`Server running on ${port}`));