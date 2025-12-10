const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');

const JWT_SECRET = "shhhh";

mongoose.connect("mongodb://127.0.0.1:27017/miniproject")
  .then(() => console.log("MongoDB connected"))
  .catch(err => console.error("MongoDB error:", err));

const userModel = require("./models/user");
const postModel = require("./models/post");

app.set('views', path.join(__dirname, 'views'));
app.set("view engine", "ejs");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'))); // serve images

//-------------- MULTER STORAGE ----------------//
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public', 'images', 'upload');
    fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    crypto.randomBytes(16, (err, raw) => {
      if (err) return cb(err);
      cb(null, raw.toString("hex") + Date.now() + ext);
    });
  }
});

function imageFilter(req, file, cb) {
  if (/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) cb(null, true);
  else cb(new Error("Only images allowed"), false);
}

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 2 * 1024 * 1024 }
});

//-------------- ROUTES ----------------//

app.get("/", (req, res) => {
  res.redirect("/register");
});

app.get("/register", (req, res) => {
  res.render("index");
});

app.get("/login", (req, res) => {
  res.render("login");
});

app.post("/register", async (req, res) => {
  let { name, username, age, email, password } = req.body;
  let exists = await userModel.findOne({ email });

  if (exists) return res.send("User already exists");

  bcrypt.hash(password, 10, async (err, hash) => {
    const newUser = await userModel.create({
      name, username, age, email, password: hash
    });

    const token = jwt.sign({ userid: newUser._id }, JWT_SECRET);
    res.cookie("token", token);

    res.redirect("/login");
  });
});

app.post("/login", async (req, res) => {
  let { email, password } = req.body;
  let user = await userModel.findOne({ email });

  if (!user) return res.send("User not found");

  bcrypt.compare(password, user.password, (err, result) => {
    if (!result) return res.send("Wrong password");

    const token = jwt.sign({ userid: user._id }, JWT_SECRET);
    res.cookie("token", token);

    res.redirect("/profile");
  });
});

function isLoggedIn(req, res, next) {
  try {
    const token = req.cookies.token;
    if (!token) return res.redirect("/login");
    const data = jwt.verify(token, JWT_SECRET);
    req.user = data;
    next();
  } catch {
    res.redirect("/login");
  }
}

//-------------- PROFILE PAGE ----------------//

app.get("/profile", isLoggedIn, async (req, res) => {
  const user = await userModel.findById(req.user.userid);
  const posts = await postModel.find({ user: req.user.userid }).sort({ date: -1 });
  res.render("profile", { user, posts });
});

//-------------- AVATAR UPLOAD ----------------//

app.post("/upload-avatar", isLoggedIn, upload.single("avatar"), async (req, res) => {
  if (!req.file) return res.send("No file uploaded");

  const user = await userModel.findById(req.user.userid);

  // delete old avatar if not default
  if (user.avatar && user.avatar !== "default.png") {
    const oldPath = path.join(__dirname, "public", "images", "upload", user.avatar);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  user.avatar = req.file.filename;
  await user.save();

  res.redirect("/profile");
});

//-------------- CREATE POST ----------------//

app.post("/create-post", isLoggedIn, async (req, res) => {
  await postModel.create({
    user: req.user.userid,
    content: req.body.content
  });
  res.redirect("/profile");
});

//-------------- LIKE POST ----------------//

app.post("/like-post/:id", isLoggedIn, async (req, res) => {
  let post = await postModel.findById(req.params.id);

  if (!post.likes.includes(req.user.userid)) {
    post.likes.push(req.user.userid);
  } else {
    post.likes = post.likes.filter(id => id != req.user.userid);
  }

  await post.save();
  res.redirect("/profile");
});

//-------------- EDIT POST ----------------//

app.post("/edit-post/:id", isLoggedIn, async (req, res) => {
  await postModel.findByIdAndUpdate(req.params.id, {
    content: req.body.newContent
  });
  res.redirect("/profile");
});

//-------------- FEED ----------------//

app.get("/feed", isLoggedIn, async (req, res) => {
  const posts = await postModel.find()
    .populate("user")
    .populate("comments.user")
    .sort({ date: -1 });

  const user = await userModel.findById(req.user.userid);

  res.render("feed", { user, posts });
});

app.post("/feed/comment/:id", isLoggedIn, async (req, res) => {
  let post = await postModel.findById(req.params.id);
  post.comments.push({
    user: req.user.userid,
    text: req.body.comment
  });
  await post.save();
  res.redirect("/feed");
});

app.post("/feed/like/:id", isLoggedIn, async (req, res) => {
  let post = await postModel.findById(req.params.id);

  if (!post.likes.includes(req.user.userid)) {
    post.likes.push(req.user.userid);
  } else {
    post.likes = post.likes.filter(id => id != req.user.userid);
  }

  await post.save();
  res.redirect("/feed");
});

//-------------- LOGOUT ----------------//

app.get("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));
