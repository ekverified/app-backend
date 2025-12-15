require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');

const app = express();
app.use(cors());
app.use(express.json());

const DATA_DIR = path.join(__dirname, 'data');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_change_in_prod';

// Ensure data dir exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Data dir error:', error);
  }
}
ensureDataDir();

// Helper: Get collection file path
function getCollectionPath(collectionName) {
  return path.join(DATA_DIR, `${collectionName}.json`);
}

// Helper: Read JSON array (creates empty if missing)
async function readCollection(collectionName) {
  const filePath = getCollectionPath(collectionName);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return []; // Empty if new
    console.error(`Read ${collectionName} error:`, error);
    return [];
  }
}

// Helper: Write JSON array
async function writeCollection(collectionName, data) {
  const filePath = getCollectionPath(collectionName);
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Write ${collectionName} error:`, error);
    throw error;
  }
}

// Middleware: JWT Auth (for admin routes)
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Auth (from members.json)
app.post('/auth', async (req, res) => {
  const { pin } = req.body;
  try {
    const members = await readCollection('members');
    const hashedPin = CryptoJS.SHA256(pin).toString();
    const member = members.find(m => m.hashedPin === hashedPin);
    if (member) {
      const token = jwt.sign({ name: member.name, email: member.email }, JWT_SECRET);
      res.json({ user: { name: member.name, email: member.email }, token });
    } else {
      res.status(401).json({ error: 'Invalid PIN' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Auth failed' });
  }
});

// News
app.get('/news', async (req, res) => {
  try {
    const news = await readCollection('news');
    res.json(news.map(row => ({ text: row.text, signedBy: row.signedBy })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});
app.post('/news', authMiddleware, async (req, res) => {
  const { text, signed_by } = req.body;
  try {
    const news = await readCollection('news');
    news.unshift({ text, signedBy: signed_by, createdAt: new Date().toLocaleString() });
    await writeCollection('news', news);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post news' });
  }
});

// Welfare
app.get('/welfare', async (req, res) => {
  const { member } = req.query;
  try {
    const welfare = await readCollection('welfare');
    const userRows = member ? welfare.filter(row => row.member === member) : welfare;
    res.json(userRows.map(row => ({ type: row.type, amount: row.amount, member: row.member, status: row.status, date: row.date })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch welfare' });
  }
});
app.post('/welfare', async (req, res) => {
  const { type, amount, member } = req.body;
  try {
    const welfare = await readCollection('welfare');
    welfare.push({ type, amount, member, status: 'Sec', date: new Date().toLocaleDateString() });
    await writeCollection('welfare', welfare);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit welfare' });
  }
});

// Polls
app.get('/polls', async (req, res) => {
  try {
    const polls = await readCollection('polls');
    res.json(polls.map(row => ({
      id: row.id || row._id || 0,
      q: row.question,
      opts: row.options || row.opts || [],
      votes: row.votes || [],
      voters: row.voters || [],
      active: row.active || false
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});
app.post('/polls', authMiddleware, async (req, res) => {
  const { question, options } = req.body;
  try {
    const polls = await readCollection('polls');
    const newPoll = {
      id: polls.length,
      question,
      options,
      votes: new Array(options.length).fill(0),
      voters: [],
      active: true,
      createdAt: new Date().toLocaleString()
    };
    polls.unshift(newPoll);
    await writeCollection('polls', polls);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Transactions
app.get('/transactions', async (req, res) => {
  const { member } = req.query;
  try {
    const transactions = await readCollection('transactions');
    const userRows = member ? transactions.filter(row => row.member === member) : transactions;
    res.json(userRows.map(row => ({ t: row.title, d: row.date, a: row.amount, type: row.type, member: row.member })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});
app.post('/transactions', authMiddleware, async (req, res) => {
  const { title, date, amount, type, member } = req.body;
  try {
    const transactions = await readCollection('transactions');
    transactions.push({ title, date, amount, type, member });
    await writeCollection('transactions', transactions);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add transaction' });
  }
});

// Approved Reports
app.get('/approved-reports', async (req, res) => {
  try {
    const reports = await readCollection('approvedreports');
    res.json(reports.map(row => ({ text: row.text, file: row.file, signedBy: row.signedBy })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});
app.post('/approved-reports', authMiddleware, async (req, res) => {
  const { text, file, signed_by } = req.body;
  try {
    const reports = await readCollection('approvedreports');
    reports.push({ text, file, signedBy: signed_by });
    await writeCollection('approvedreports', reports);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add report' });
  }
});

// Chair Queue
app.get('/chair-queue', async (req, res) => {
  try {
    const queue = await readCollection('chairqueue');
    res.json(queue.map(row => ({ type: row.type, data: row.data || {}, author: row.author })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});
app.post('/chair-queue', authMiddleware, async (req, res) => {
  const { type, data, author } = req.body;
  try {
    const queue = await readCollection('chairqueue');
    queue.push({ type, data, author });
    await writeCollection('chairqueue', queue);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});
app.delete('/chair-queue/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const queue = await readCollection('chairqueue');
    const newQueue = queue.filter((_, index) => index.toString() !== id);
    await writeCollection('chairqueue', newQueue);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// Logs
app.get('/logs', async (req, res) => {
  try {
    const logs = await readCollection('logs');
    res.json(logs.map(row => ({ action: row.action, by: row.by, details: row.details, timestamp: row.timestamp })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});
app.post('/logs', authMiddleware, async (req, res) => {
  const { action, by, details } = req.body;
  try {
    const logs = await readCollection('logs');
    logs.push({ action, by, details, timestamp: new Date().toLocaleString() });
    await writeCollection('logs', logs);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to log' });
  }
});

// Notifications
app.get('/notifications', async (req, res) => {
  const { member } = req.query;
  try {
    const notifs = await readCollection('notifications');
    const userRows = member ? notifs.filter(row => row.member === member) : notifs;
    res.json(userRows.map((row, index) => ({ id: index, msg: row.message, read: row.read || false })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});
app.post('/notifications', authMiddleware, async (req, res) => {
  const { message, member } = req.body;
  try {
    const notifs = await readCollection('notifications');
    notifs.push({ message, member, read: false });
    await writeCollection('notifications', notifs);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add notification' });
  }
});
app.patch('/notifications/:id/read', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const notifs = await readCollection('notifications');
    if (notifs[id]) {
      notifs[id].read = true;
      await writeCollection('notifications', notifs);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// Loans
app.get('/loans', async (req, res) => {
  const { member } = req.query;
  try {
    const loans = await readCollection('loans');
    const userRows = member ? loans.filter(row => row.member === member) : loans;
    res.json(userRows.map(row => ({ amount: row.amount, purpose: row.purpose, member: row.member, status: row.status, date: row.date })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});
app.post('/loans', async (req, res) => {
  const { amount, purpose, member } = req.body;
  try {
    const loans = await readCollection('loans');
    loans.push({ amount, purpose, member, status: 'Pending', date: new Date().toLocaleDateString() });
    await writeCollection('loans', loans);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit loan' });
  }
});

// Signatures
app.get('/signatures', async (req, res) => {
  try {
    const sigs = await readCollection('signatures');
    const sigObj = sigs.reduce((acc, row) => ({ ...acc, [row.role]: row.signature }), {});
    res.json(sigObj);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch signatures' });
  }
});
app.patch('/signatures/:role', authMiddleware, async (req, res) => {
  const { role } = req.params;
  const { signature } = req.body;
  try {
    const sigs = await readCollection('signatures');
    const existing = sigs.find(r => r.role === role);
    if (existing) {
      existing.signature = signature;
    } else {
      sigs.push({ role, signature });
    }
    await writeCollection('signatures', sigs);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update signature' });
  }
});

// Members
app.get('/members', authMiddleware, async (req, res) => {
  try {
    const members = await readCollection('members');
    res.json(members.map(m => ({ name: m.name, email: m.email }))); // Hide hashedPin
  } catch (error) {
    console.error('Members fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});
app.post('/members', authMiddleware, async (req, res) => {
  const { name, email, pin } = req.body;
  try {
    const members = await readCollection('members');
    const hashedPin = CryptoJS.SHA256(pin).toString();
    members.push({ name, email, hashedPin });
    await writeCollection('members', members);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});
app.delete('/members/:name', authMiddleware, async (req, res) => {
  const { name } = req.params;
  try {
    const members = await readCollection('members');
    const newMembers = members.filter(m => m.name !== name);
    await writeCollection('members', newMembers);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
