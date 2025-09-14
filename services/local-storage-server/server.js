
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(process.cwd(), 'data');
const SECRET = process.env.STORAGE_JWT_SECRET || 'dev-secret';
fs.mkdirSync(STORAGE_ROOT, { recursive: true });

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const key = req.query.key || req.body.key || 'uploads';
    const dir = path.join(STORAGE_ROOT, key.toString());
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

app.get('/signed-put', (req, res) => {
  const { key, contentType } = req.query;
  const token = jwt.sign({ key, contentType, type: 'put' }, SECRET, { expiresIn: '5m' });
  res.json({ url: `/upload?token=${token}`, token });
});

app.post('/upload', upload.single('file'), (req, res) => {
  const token = req.query.token;
  try {
    jwt.verify(token, SECRET);
    res.json({ ok: true });
  } catch (e) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

app.get('/signed-get', (req, res) => {
  const { key, filename } = req.query;
  const token = jwt.sign({ key, filename, type: 'get' }, SECRET, { expiresIn: '15m' });
  res.json({ url: `/download?token=${token}`, token });
});

app.get('/download', (req, res) => {
  const { token } = req.query;
  try {
    const payload = jwt.verify(token, SECRET);
    const filePath = path.join(STORAGE_ROOT, payload.key, payload.filename);
    res.sendFile(filePath);
  } catch (e) {
    res.status(401).send('Invalid token');
  }
});

const port = process.env.PORT || 4005;
app.listen(port, () => console.log(`Local storage server on :${port}`));
