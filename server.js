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
const JWT_EXPIRY = '1h'; // Enhancement: Token expires in 1 hour

// Ensure data dir exists and init default data
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    // Init empty collections if missing
    const collections = ['news', 'welfare', 'polls', 'transactions', 'approvedreports', 'chairqueue', 'logs', 'notifications', 'loans', 'signatures'];
    for (const coll of collections) {
      const filePath = path.join(DATA_DIR, `${coll}.json`);
      try {
        await fs.access(filePath);
      } catch {
        await fs.writeFile(filePath, JSON.stringify([], null, 2));
        console.log(`Initialized empty ${coll}.json`);
      }
    }
    // Special init for members: Create defaults with hashed PINs and roles if empty
    const membersPath = path.join(DATA_DIR, 'members.json');
    try {
      const membersData = await fs.readFile(membersPath, 'utf8');
      const members = JSON.parse(membersData);
      if (members.length === 0) {
        const defaults = [
          {
            name: 'Felix',
            email: 'felix@example.com',
            hashedPin: CryptoJS.SHA256('1234').toString(),
            role: 'member'
          },
          {
            name: 'enoch thumbi',
            email: 'thumbikamauenoch0@gmail.com',
            hashedPin: CryptoJS.SHA256('3333').toString(),
            role: 'chairperson'  // Admin for testing
          }
        ];
        await fs.writeFile(membersPath, JSON.stringify(defaults, null, 2));
        console.log('Initialized default members with hashed PINs and roles');
      } else {
        // Ensure all members have role if missing
        const updated = members.map(m => ({ ...m, role: m.role || 'member' }));
        if (JSON.stringify(members) !== JSON.stringify(updated)) {
          await fs.writeFile(membersPath, JSON.stringify(updated, null, 2));
          console.log('Added roles to existing members');
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Create with defaults if fully missing
        const defaults = [
          {
            name: 'Felix',
            email: 'felix@example.com',
            hashedPin: CryptoJS.SHA256('1234').toString(),
            role: 'member'
          },
          {
            name: 'enoch thumbi',
            email: 'thumbikamauenoch0@gmail.com',
            hashedPin: CryptoJS.SHA256('3333').toString(),
            role: 'chairperson'
          }
        ];
        await fs.writeFile(membersPath, JSON.stringify(defaults, null, 2));
        console.log('Created members.json with default hashed users and roles');
      } else {
        console.error('Members init error:', error);
      }
    }
    // Enhancement: Add sample data if empty for testing
    if ((await readCollection('news')).length === 0) {
      const sampleNews = [{ text: 'Welcome to Insightful Eight Ltd!', signedBy: 'Chairperson', createdAt: new Date().toLocaleString() }];
      await writeCollection('news', sampleNews);
      console.log('Added sample news');
    }
    if ((await readCollection('transactions')).length === 0) {
      const sampleTrans = [{ title: 'Monthly Contribution', date: new Date().toLocaleDateString(), amount: 5000, type: 'in', member: 'Felix' }];
      await writeCollection('transactions', sampleTrans);
      console.log('Added sample transaction');
    }
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
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    // Check if admin for protected routes (enhancement: explicit roles)
    if (req.user.role && !['secretary', 'treasurer', 'chairperson', 'supervisorycommittee', 'committeemember'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Auth (updated to support email + PIN, include role in token)
app.post('/auth', async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'Email and PIN required' });
  try {
    const members = await readCollection('members');
    const member = members.find(m => m.email === email);
    if (!member) return res.status(401).json({ error: 'Invalid Email or PIN' });
    const hashedPin = CryptoJS.SHA256(pin).toString();
    if (member.hashedPin === hashedPin) {
      const token = jwt.sign({ name: member.name, email: member.email, role: member.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      res.json({ user: { name: member.name, email: member.email, role: member.role }, token });
    } else {
      res.status(401).json({ error: 'Invalid Email or PIN' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// PIN Reset (public, demo: sets to '1234' and logs; prod: email new PIN)
app.post('/reset-pin', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const members = await readCollection('members');
    const member = members.find(m => m.email === email);
    if (!member) return res.status(404).json({ error: 'Member not found' });
    const newPin = '1234';
    const hashedPin = CryptoJS.SHA256(newPin).toString();
    member.hashedPin = hashedPin;
    await writeCollection('members', members);
    console.log(`PIN reset for ${email} to ${newPin} (prod: send email)`); // Enhancement: Prod note
    res.json({ success: true, message: 'PIN reset to 1234. Check console or contact admin for secure delivery.' });
  } catch (error) {
    console.error('Reset PIN error:', error);
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Members (Public POST for registration, protected GET/PUT/DELETE/PROMOTE for admin/own)
app.get('/members', authMiddleware, async (req, res) => {
  try {
    const members = await readCollection('members');
    const { role } = req.query;
    const filtered = role ? members.filter(m => m.role === role) : members;
    res.json(filtered.map(m => ({ name: m.name, email: m.email, role: m.role }))); // Hide hashedPin
  } catch (error) {
    console.error('Members fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

app.post('/members', async (req, res) => { // No auth - public registration
  const { name, email, pin } = req.body;
  // Enhancement: Basic validation
  if (!name || !email || !pin || pin.length !== 4 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid input: Name, valid email, and 4-digit PIN required' });
  }
  try {
    const members = await readCollection('members');
    // Check for duplicate email/name
    if (members.find(m => m.email === email || m.name === name)) {
      return res.status(409).json({ error: 'User already exists' });
    }
    const hashedPin = CryptoJS.SHA256(pin).toString();
    members.push({ name, email, hashedPin, role: 'member' });
    await writeCollection('members', members);
    console.log(`New member registered: ${name} (${email})`);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

app.put('/members/:email', authMiddleware, async (req, res) => {
  const { email: targetEmail } = req.params;
  const { name, newPin } = req.body;
  // Enhancement: Self or chair only
  if (req.user.email !== targetEmail && req.user.role !== 'chairperson') {
    return res.status(403).json({ error: 'Can only update own profile or as chair' });
  }
  // Validation
  if (name && (!name.trim() || name.length < 2)) return res.status(400).json({ error: 'Valid name required' });
  if (newPin && newPin.length !== 4) return res.status(400).json({ error: 'PIN must be 4 digits' });
  try {
    const members = await readCollection('members');
    const memberIndex = members.findIndex(m => m.email === targetEmail);
    if (memberIndex === -1) return res.status(404).json({ error: 'Member not found' });
    if (name) members[memberIndex].name = name.trim();
    if (newPin) members[memberIndex].hashedPin = CryptoJS.SHA256(newPin).toString();
    await writeCollection('members', members);
    res.json({ success: true });
  } catch (error) {
    console.error('Update member error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.post('/members/:email/promote', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chairperson') {
    return res.status(403).json({ error: 'Chair only' });
  }
  const { email: targetEmail } = req.params;
  const { role } = req.body; // e.g., 'secretary'
  if (!['secretary', 'treasurer', 'chairperson', 'supervisorycommittee', 'committeemember'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  try {
    const members = await readCollection('members');
    const memberIndex = members.findIndex(m => m.email === targetEmail);
    if (memberIndex === -1) return res.status(404).json({ error: 'Member not found' });
    members[memberIndex].role = role;
    await writeCollection('members', members);
    console.log(`Promoted ${targetEmail} to ${role}`);
    res.json({ success: true });
  } catch (error) {
    console.error('Promote error:', error);
    res.status(500).json({ error: 'Promotion failed' });
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

// News
app.get('/news', async (req, res) => {
  try {
    const news = await readCollection('news');
    res.json(news.map(row => ({ text: row.text, signedBy: row.signedBy, createdAt: row.createdAt }))); // Enhancement: Include date
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});
app.post('/news', authMiddleware, async (req, res) => {
  const { text, signed_by } = req.body;
  if (!text || !signed_by) return res.status(400).json({ error: 'Text and signer required' });
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
  if (!type || !amount || amount <= 0 || !member) return res.status(400).json({ error: 'Valid type, positive amount, and member required' }); // Enhancement: Validation
  try {
    const welfare = await readCollection('welfare');
    welfare.push({ type, amount: parseInt(amount), member, status: 'Sec', date: new Date().toLocaleDateString() });
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
  if (!question || !options || options.length < 2) return res.status(400).json({ error: 'Question and at least 2 options required' });
  try {
    const polls = await readCollection('polls');
    const newPoll = {
      id: Date.now(),
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
  if (!title || !date || amount <= 0 || !['in', 'out'].includes(type) || !member) return res.status(400).json({ error: 'Valid title, date, positive amount, type (in/out), and member required' });
  try {
    const transactions = await readCollection('transactions');
    transactions.push({ title, date, amount: parseInt(amount), type, member });
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
  if (!text || !signed_by) return res.status(400).json({ error: 'Text and signer required' });
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
    res.json(queue.map(row => ({ id: row.id, type: row.type, data: row.data || {}, author: row.author })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});
app.post('/chair-queue', authMiddleware, async (req, res) => {
  const { type, data, author } = req.body;
  if (!type || !data || !author) return res.status(400).json({ error: 'Type, data, and author required' });
  try {
    const queue = await readCollection('chairqueue');
    const newItem = { id: Date.now().toString(), type, data, author, createdAt: new Date().toLocaleString() };
    queue.push(newItem);
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
    const newQueue = queue.filter(row => row.id !== id);
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
  if (!action || !by) return res.status(400).json({ error: 'Action and by required' });
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
  if (!message) return res.status(400).json({ error: 'Message required' });
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
  if (!amount || amount <= 0 || !purpose || !member) return res.status(400).json({ error: 'Positive amount, purpose, and member required' });
  try {
    const loans = await readCollection('loans');
    loans.push({ amount: parseInt(amount), purpose, member, status: 'Pending', date: new Date().toLocaleDateString() });
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
  if (!signature) return res.status(400).json({ error: 'Signature required' });
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

// Logout (simple token clear; frontend handles redirect)
app.post('/logout', (req, res) => {
  res.json({ success: true }); // Client clears token
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
