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
const JWT_EXPIRY = '1h';

// Ensure data dir exists and init default data (enhanced with samples for workflows)
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
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
    const membersPath = path.join(DATA_DIR, 'members.json');
    try {
      const membersData = await fs.readFile(membersPath, 'utf8');
      const members = JSON.parse(membersData);
      if (members.length === 0) {
        const defaults = [
          { name: 'Felix', email: 'felix@example.com', hashedPin: CryptoJS.SHA256('1234').toString(), role: 'member' },
          { name: 'enoch thumbi', email: 'thumbikamauenoch0@gmail.com', hashedPin: CryptoJS.SHA256('3333').toString(), role: 'chairperson' }
        ];
        await fs.writeFile(membersPath, JSON.stringify(defaults, null, 2));
        console.log('Initialized default members');
      } else {
        const updated = members.map(m => ({ ...m, role: m.role || 'member' }));
        if (JSON.stringify(members) !== JSON.stringify(updated)) {
          await fs.writeFile(membersPath, JSON.stringify(updated, null, 2));
          console.log('Added roles to members');
        }
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        const defaults = [
          { name: 'Felix', email: 'felix@example.com', hashedPin: CryptoJS.SHA256('1234').toString(), role: 'member' },
          { name: 'enoch thumbi', email: 'thumbikamauenoch0@gmail.com', hashedPin: CryptoJS.SHA256('3333').toString(), role: 'chairperson' }
        ];
        await fs.writeFile(membersPath, JSON.stringify(defaults, null, 2));
      } else {
        console.error('Members init error:', error);
      }
    }
    // Sample data for testing workflows
    if ((await readCollection('loans')).length === 0) {
      await writeCollection('loans', [{ amount: 50000, purpose: 'Business Expansion', member: 'Felix', status: 'Pending', date: new Date().toLocaleDateString(), id: 1 }]);
      console.log('Added sample loan');
    }
    if ((await readCollection('chairqueue')).length === 0) {
      await writeCollection('chairqueue', [{ id: '1', type: 'Minutes', data: { text: 'Sample Minutes' }, author: 'Secretary', status: 'Pending' }]);
      console.log('Added sample queue item');
    }
    if ((await readCollection('news')).length === 0) {
      await writeCollection('news', [{ text: 'Welcome!', signedBy: 'Chairperson', createdAt: new Date().toLocaleString() }]);
    }
  } catch (error) {
    console.error('Data dir error:', error);
  }
}
ensureDataDir();

function getCollectionPath(collectionName) {
  return path.join(DATA_DIR, `${collectionName}.json`);
}

async function readCollection(collectionName) {
  const filePath = getCollectionPath(collectionName);
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    console.error(`Read ${collectionName} error:`, error);
    return [];
  }
}

async function writeCollection(collectionName, data) {
  const filePath = getCollectionPath(collectionName);
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Write ${collectionName} error:`, error);
    throw error;
  }
}

const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    if (req.user.role && !['secretary', 'treasurer', 'chairperson', 'supervisorycommittee', 'committeemember'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Auth (role in token)
app.post('/auth', async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'Email and PIN required' });
  try {
    const members = await readCollection('members');
    const member = members.find(m => m.email === email);
    if (!member) return res.status(401).json({ error: 'Invalid Email or PIN' });
    const hashedPin = CryptoJS.SHA256(pin).toString();
    if (member.hashedPin === hashedPin) {
      const token = jwt.sign({ name: member.name, email: member.email, role: member.role }, JWT_SECRET, { expiresIn: '1h' });
      res.json({ user: { name: member.name, email: member.email, role: member.role }, token });
    } else {
      res.status(401).json({ error: 'Invalid Email or PIN' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

// Admin PIN Re-Auth (new: for switch, refreshes token if PIN matches)
app.post('/auth/admin-pin', authMiddleware, async (req, res) => {
  const { pin } = req.body;
  const { email } = req.user;
  try {
    const members = await readCollection('members');
    const member = members.find(m => m.email === email);
    if (!member) return res.status(401).json({ error: 'Member not found' });
    const hashedPin = CryptoJS.SHA256(pin).toString();
    if (member.hashedPin === hashedPin && ['secretary', 'treasurer', 'chairperson', 'supervisorycommittee', 'committeemember'].includes(member.role)) {
      const token = jwt.sign({ name: member.name, email, role: member.role }, JWT_SECRET, { expiresIn: '1h' });
      res.json({ token });
    } else {
      res.status(401).json({ error: 'Invalid PIN or non-admin role' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Re-auth failed' });
  }
});

// PIN Reset
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
    console.log(`PIN reset for ${email} to ${newPin}`);
    res.json({ success: true, message: 'PIN reset to 1234. Contact admin for secure delivery.' });
  } catch (error) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Members
app.get('/members', authMiddleware, async (req, res) => {
  try {
    const members = await readCollection('members');
    const { role } = req.query;
    const filtered = role ? members.filter(m => m.role === role) : members;
    res.json(filtered.map(m => ({ name: m.name, email: m.email, role: m.role })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

app.post('/members', async (req, res) => {
  const { name, email, pin } = req.body;
  if (!name || !email || !pin || pin.length !== 4 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid input' });
  }
  try {
    const members = await readCollection('members');
    if (members.find(m => m.email === email || m.name === name)) {
      return res.status(409).json({ error: 'User already exists' });
    }
    const hashedPin = CryptoJS.SHA256(pin).toString();
    members.push({ name, email, hashedPin, role: 'member' });
    await writeCollection('members', members);
    console.log(`Registered new member: ${name} (${email})`);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

app.put('/members/:email', authMiddleware, async (req, res) => {
  const { email: targetEmail } = req.params;
  const { name, newPin } = req.body;
  if (req.user.email !== targetEmail && req.user.role !== 'chairperson') {
    return res.status(403).json({ error: 'Can only update own profile or as chair' });
  }
  if (name && (!name.trim() || name.length < 2)) return res.status(400).json({ error: 'Valid name required' });
  if (newPin && newPin.length !== 4) return res.status(400).json({ error: 'PIN must be 4 digits' });
  try {
    const members = await readCollection('members');
    const memberIndex = members.findIndex(m => m.email === targetEmail);
    if (memberIndex === -1) return res.status(404).json({ error: 'Member not found' });
    if (name) members[memberIndex].name = name.trim();
    if (newPin) members[memberIndex].hashedPin = CryptoJS.SHA256(newPin).toString();
    await writeCollection('members', members);
    console.log(`Updated member: ${targetEmail}`); // Debug log
    res.json({ success: true });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
});

app.post('/members/:email/promote', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chairperson') return res.status(403).json({ error: 'Chair only' });
  const { email: targetEmail } = req.params;
  const { role } = req.body;
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
    res.status(500).json({ error: 'Promotion failed' });
  }
});

// Loans (enhanced with status filter, PATCH for approve)
app.get('/loans', async (req, res) => {
  const { member, status } = req.query;
  try {
    const loans = await readCollection('loans');
    let userRows = loans;
    if (member) userRows = userRows.filter(row => row.member === member);
    if (status) userRows = userRows.filter(row => row.status === status);
    res.json(userRows.map(row => ({ id: row.id, amount: row.amount, purpose: row.purpose, member: row.member, status: row.status, date: row.date })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

app.post('/loans', async (req, res) => {
  const { amount, purpose, member } = req.body;
  if (!amount || amount <= 0 || !purpose || !member) return res.status(400).json({ error: 'Invalid input' });
  try {
    const loans = await readCollection('loans');
    const newLoan = { id: Date.now(), amount: parseInt(amount), purpose, member, status: 'Pending', date: new Date().toLocaleDateString() };
    loans.push(newLoan);
    await writeCollection('loans', loans);
    // Notify treasurer/secretary/chair via notifications
    await writeCollection('notifications', await readCollection('notifications').then(n => [...n, { message: `New loan request from ${member}: ${purpose}`, member: 'treasurer' }, { message: `New loan from ${member}`, member: 'secretary' }, { message: `Pending loan approval`, member: 'chairperson' }]));
    res.status(201).json({ success: true, id: newLoan.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit loan' });
  }
});

app.patch('/loans/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body; // e.g., 'Treas Approved'
  if (!['treasurer', 'secretary', 'chairperson'].includes(req.user.role)) return res.status(403).json({ error: 'Role not authorized' });
  try {
    const loans = await readCollection('loans');
    const loanIndex = loans.findIndex(l => l.id == id);
    if (loanIndex === -1) return res.status(404).json({ error: 'Loan not found' });
    loans[loanIndex].status = status;
    if (notes) loans[loanIndex].notes = notes;
    await writeCollection('loans', loans);
    // Queue to next (e.g., Treas -> Chair)
    if (status === 'Treas Approved') {
      const queue = await readCollection('chairqueue');
      queue.push({ id: Date.now().toString(), type: 'Loan', data: loans[loanIndex], author: req.user.name });
      await writeCollection('chairqueue', queue);
    }
    // Notify member
    await writeCollection('notifications', await readCollection('notifications').then(n => [...n, { message: `Loan status: ${status}`, member: loans[loanIndex].member, read: false }]));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Chair Queue (generic for workflows)
app.get('/chair-queue', authMiddleware, async (req, res) => {
  const { role } = req.user; // Role filter
  try {
    const queue = await readCollection('chairqueue');
    let filtered = queue;
    if (role === 'supervisorycommittee' || role === 'committeemember') filtered = queue.filter(q => ['Loan', 'Minutes', 'Report'].includes(q.type)); // View-only
    res.json(filtered.map(row => ({ id: row.id, type: row.type, data: row.data, author: row.author, status: row.status || 'Pending' })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

app.post('/chair-queue', authMiddleware, async (req, res) => {
  const { type, data, author } = req.body;
  const allowedRoles = { Minutes: 'secretary', Loan: 'treasurer', Report: 'treasurer' };
  if (req.user.role !== allowedRoles[type]) return res.status(403).json({ error: 'Role not authorized for type' });
  try {
    const queue = await readCollection('chairqueue');
    const newItem = { id: Date.now().toString(), type, data, author: req.user.name, status: 'Pending', createdAt: new Date().toLocaleString() };
    queue.push(newItem);
    await writeCollection('chairqueue', queue);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

app.patch('/chair-queue/:id/approve', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chairperson') return res.status(403).json({ error: 'Chair only' });
  const { id } = req.params;
  const { signature } = req.body;
  try {
    const queue = await readCollection('chairqueue');
    const itemIndex = queue.findIndex(q => q.id === id);
    if (itemIndex === -1) return res.status(404).json({ error: 'Item not found' });
    queue[itemIndex].status = 'Approved';
    if (signature) queue[itemIndex].signature = signature;
    await writeCollection('chairqueue', queue);
    // Publish to members (e.g., to news/approvedreports)
    const { type, data } = queue[itemIndex];
    if (type === 'Minutes' || type === 'Report') {
      const targetColl = type === 'Minutes' ? 'news' : 'approvedreports';
      const coll = await readCollection(targetColl);
      coll.push({ ...data, signedBy: req.user.name, approvedAt: new Date().toLocaleString() });
      await writeCollection(targetColl, coll);
    }
    // Notify all
    const members = await readCollection('members');
    const notifs = await readCollection('notifications');
    members.forEach(m => notifs.push({ message: `${type} approved by Chair`, member: m.name, read: false }));
    await writeCollection('notifications', notifs);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Approval failed' });
  }
});

app.post('/chair-queue', authMiddleware, async (req, res) => { // Generic post for notes
  // ... (existing)
});

// Export for Supervisory (CSV logs/queue)
app.get('/export/:type', authMiddleware, async (req, res) => {
  if (!['logs', 'queue', 'loans'].includes(req.params.type) || req.user.role !== 'supervisorycommittee') return res.status(403).json({ error: 'Unauthorized' });
  try {
    const data = await readCollection(req.params.type);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${req.params.type}.csv`);
    const csv = data.map(row => Object.values(row).join(',')).join('\n');
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: 'Export failed' });
  }
});

// Other endpoints unchanged (news, welfare, etc.) - abbreviated for space
// ... (paste full from previous server.js: news, welfare, polls, transactions, approved-reports, logs, notifications, signatures, logout)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
