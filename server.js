const express = require('express');
const session = require('express-session');
const multer = require('multer');
const { google } = require('googleapis');
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());  // For JSON parsing
app.use(express.urlencoded({ extended: true }));  // For form data parsing
app.use(express.static('public'));  // Serve frontend files

// Session setup
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
}));

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Define User Schema
const UserSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  profilePicture: String,
});

const User = mongoose.model('User', UserSchema);

// Google Drive API setup
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

const drive = google.drive({ version: 'v3', auth: oauth2Client });

// Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Middleware to check if user is logged in
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login.html');
  }
};

// Routes
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.get('/auth/google', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/drive'],
  });
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: { name, email, picture } } = await oauth2.userinfo.get();

    req.session.user = { name, email, picture, tokens };

    // Save user to DB if not exists
    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      await User.create({ name, email, profilePicture: picture });
    }

    res.redirect('/dashboard.html');
  } catch (error) {
    console.error('Error during authentication:', error);
    res.status(500).send('Authentication failed');
  }
});

// Fetch user profile
app.get('/profile', isAuthenticated, async (req, res) => {
  const user = await User.findOne({ email: req.session.user.email });
  res.json(user || { error: 'User not found' });
});

// Update user profile
app.post('/profile', isAuthenticated, async (req, res) => {
  const { name, profilePicture } = req.body;
  const user = await User.findOneAndUpdate(
    { email: req.session.user.email },
    { name, profilePicture },
    { new: true, upsert: true }
  );
  res.json({ message: 'Profile updated successfully', user });
});

// Upload file to Google Drive
app.post('/upload', isAuthenticated, upload.single('file'), async (req, res) => {
  try {
    const { file } = req;
    const folderName = req.body.folderName || 'Case Files';

    // Create folder if it doesn't exist
    const folderResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
      },
      fields: 'id',
    });

    const folderId = folderResponse.data.id;

    // Upload file to the folder
    await drive.files.create({
      requestBody: {
        name: file.originalname,
        parents: [folderId],
      },
      media: {
        mimeType: file.mimetype,
        body: require('fs').createReadStream(file.path),
      },
    });

    res.send('File uploaded successfully!');
  } catch (error) {
    console.error(error);
    res.status(500).send('Error uploading file');
  }
});

// Logout route
app.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login.html');
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
