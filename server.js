require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');
const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_change_in_prod';
const JWT_EXPIRY = '1h';

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
  process.exit(1);
}
console.log('Supabase connected');

// Helper: Supabase op (select/insert/update)
const runQuery = async (table, op, data = {}, filters = {}) => {
  try {
    let q = supabase.from(table);
    if (op === 'select') q = q.select('*');
    if (op === 'insert') q = q.insert([data]);
    if (op === 'update') {
      q = q.update(data);
      if (filters.id) q = q.eq('id', filters.id);
      if (filters.email) q = q.eq('email', filters.email);
    }
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.member) q = q.eq('member', filters.member);
    if (filters.role) q = q.eq('role', filters.role);
    const { data: result, error } = await q;
    if (error) throw error;
    console.log(`${table} ${op}: ${result?.length || 1} rows`); // Debug
    return result;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Init (create tables if missing, add defaults)
const initDb = async () => {
  const tables = ['members', 'news', 'welfare', 'polls', 'transactions', 'approvedreports', 'chairqueue', 'logs', 'notifications', 'loans', 'signatures'];
  for (const table of tables) {
    const { error } = await supabase.from(table).select('id').limit(1);
    if (error?.message?.includes('relation')) {
      // Simple schema via insert (Supabase auto-creates)
      await supabase.from(table).insert({}); // Triggers create
      console.log(`Created table: ${table}`);
    }
  }
  // Defaults if no members
  const { data: members } = await supabase.from('members').select('id').limit(1);
  if (!members?.length) {
    const defaults = [
      { name: 'Felix', email: 'felix@example.com', hashedPin: CryptoJS.SHA256('1234').toString(), role: 'member' },
      { name: 'enoch thumbi', email: 'thumbikamauenoch0@gmail.com', hashedPin: CryptoJS.SHA256('3333').toString(), role: 'chairperson' }
    ];
    await supabase.from('members').insert(defaults);
    console.log('Added defaults');
  }
};
initDb();

// Auth Middleware
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Auth
app.post('/auth', async (req, res) => {
  const { email, pin } = req.body;
  if (!email || !pin) return res.status(400).json({ error: 'Email and PIN required' });
  try {
    const { data: members } = await supabase.from('members').select('*').eq('email', email).single();
    if (!members) return res.status(401).json({ error: 'Invalid Email or PIN' });
    const hashedPin = CryptoJS.SHA256(pin).toString();
    if (members.hashedPin === hashedPin) {
      const token = jwt.sign({ name: members.name, email, role: members.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      res.json({ user: { name: members.name, email, role: members.role }, token });
    } else {
      res.status(401).json({ error: 'Invalid Email or PIN' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Auth failed' });
  }
});

// Admin PIN Re-Auth
app.post('/auth/admin-pin', authMiddleware, async (req, res) => {
  const { pin } = req.body;
  const { email } = req.user;
  try {
    const { data: members } = await supabase.from('members').select('*').eq('email', email).single();
    if (!members) return res.status(401).json({ error: 'Member not found' });
    const hashedPin = CryptoJS.SHA256(pin).toString();
    if (members.hashedPin === hashedPin && ['secretary', 'treasurer', 'chairperson', 'supervisorycommittee', 'committeemember'].includes(members.role)) {
      const token = jwt.sign({ name: members.name, email, role: members.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
      res.json({ token });
    } else {
      res.status(401).json({ error: 'Invalid PIN or non-admin' });
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
    const newPin = '1234';
    const hashedPin = CryptoJS.SHA256(newPin).toString();
    await runQuery('members', 'update', { hashedPin }, { email });
    console.log(`PIN reset for ${email}`);
    res.json({ success: true, message: 'PIN reset to 1234' });
  } catch (error) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Members
app.get('/members', authMiddleware, async (req, res) => {
  try {
    const { role } = req.query;
    const filters = role ? { role } : {};
    const members = await runQuery('members', 'select', {}, filters);
    res.json(members);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

app.post('/members', async (req, res) => {
  const { name, email, pin } = req.body;
  if (!name || !email || !pin || pin.length !== 4 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid input' });
  try {
    const hashedPin = CryptoJS.SHA256(pin).toString();
    await runQuery('members', 'insert', { name, email, hashedPin, role: 'member' });
    console.log(`Registered: ${name} (${email})`);
    res.status(201).json({ success: true });
  } catch (error) {
    if (error.message.includes('duplicate key')) res.status(409).json({ error: 'User exists' });
    else res.status(500).json({ error: 'Failed to add member' });
  }
});

app.put('/members/:email', authMiddleware, async (req, res) => {
  const { email: targetEmail } = req.params;
  const { name, newPin } = req.body;
  if (req.user.email !== targetEmail && req.user.role !== 'chairperson') return res.status(403).json({ error: 'Unauthorized' });
  if (name && (!name.trim() || name.length < 2)) return res.status(400).json({ error: 'Valid name required' });
  if (newPin && newPin.length !== 4) return res.status(400).json({ error: '4-digit PIN required' });
  try {
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (newPin) updateData.hashedPin = CryptoJS.SHA256(newPin).toString();
    await runQuery('members', 'update', updateData, { email: targetEmail });
    console.log(`Updated: ${targetEmail}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

app.post('/members/:email/promote', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chairperson') return res.status(403).json({ error: 'Chair only' });
  const { email: targetEmail } = req.params;
  const { role } = req.body;
  if (!['secretary', 'treasurer', 'chairperson', 'supervisorycommittee', 'committeemember'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  try {
    await runQuery('members', 'update', { role }, { email: targetEmail });
    console.log(`Promoted ${targetEmail} to ${role}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Promotion failed' });
  }
});

// News
app.get('/news', async (req, res) => {
  try {
    const news = await runQuery('news', 'select');
    res.json(news);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

app.post('/news', authMiddleware, async (req, res) => {
  const { text, signed_by } = req.body;
  if (!text || !signed_by) return res.status(400).json({ error: 'Text and signed_by required' });
  try {
    await runQuery('news', 'insert', { text, signedBy: signed_by, createdAt: new Date().toISOString() });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post news' });
  }
});

// Welfare
app.get('/welfare', async (req, res) => {
  const { member, status } = req.query;
  try {
    const filters = { ...(member && { member }), ...(status && { status }) };
    const welfare = await runQuery('welfare', 'select', {}, filters);
    res.json(welfare);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch welfare' });
  }
});

app.post('/welfare', async (req, res) => {
  const { type, amount, member } = req.body;
  if (!type || !amount || !member) return res.status(400).json({ error: 'Type, amount, member required' });
  try {
    await runQuery('welfare', 'insert', { type, amount: parseInt(amount), member, date: new Date().toLocaleDateString() });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit welfare' });
  }
});

// Polls
app.get('/polls', async (req, res) => {
  try {
    const polls = await runQuery('polls', 'select');
    res.json(polls.map(p => ({
      id: p.id,
      question: p.question,
      options: JSON.parse(p.options || '[]'),
      votes: JSON.parse(p.votes || '[]'),
      voters: JSON.parse(p.voters || '[]'),
      active: p.active
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});

app.post('/polls', authMiddleware, async (req, res) => {
  const { question, options } = req.body;
  if (!question || !Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'Question and 2+ options array required' });
  try {
    const id = Date.now();
    await runQuery('polls', 'insert', {
      id,
      question,
      options: JSON.stringify(options),
      votes: JSON.stringify(new Array(options.length).fill(0)),
      voters: JSON.stringify([]),
      createdAt: new Date().toLocaleString()
    });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Loans
app.get('/loans', async (req, res) => {
  const { member, status } = req.query;
  try {
    const filters = { ...(member && { member }), ...(status && { status }) };
    const loans = await runQuery('loans', 'select', {}, filters);
    res.json(loans);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

app.post('/loans', async (req, res) => {
  const { amount, purpose, member } = req.body;
  if (!amount || amount <= 0 || !purpose || !member) return res.status(400).json({ error: 'Invalid input' });
  try {
    const id = Date.now();
    await runQuery('loans', 'insert', { id, amount: parseInt(amount), purpose, member, date: new Date().toLocaleDateString() });
    res.status(201).json({ success: true, id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit loan' });
  }
});

app.patch('/loans/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status, notes } = req.body;
  if (!['treasurer', 'secretary', 'chairperson'].includes(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
  try {
    const updateData = { status };
    if (notes) updateData.notes = notes;
    await runQuery('loans', 'update', updateData, { id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Chair Queue
app.get('/chair-queue', authMiddleware, async (req, res) => {
  try {
    const queue = await runQuery('chairqueue', 'select');
    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

app.post('/chair-queue', authMiddleware, async (req, res) => {
  const { type, data, author } = req.body;
  try {
    const id = Date.now().toString();
    await runQuery('chairqueue', 'insert', { id, type, data: JSON.stringify(data), author, createdAt: new Date().toLocaleString() });
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
    const updateData = { status: 'Approved' };
    if (signature) updateData.signature = signature;
    await runQuery('chairqueue', 'update', updateData, { id });
    // Publish to news or approvedreports based on type
    const { data: item } = await supabase.from('chairqueue').select('*').eq('id', id).single();
    if (item && item.type === 'Minutes') {
      await runQuery('news', 'insert', { text: item.data.text, signedBy: req.user.name, createdAt: new Date().toLocaleString() });
    } else if (item && item.type === 'Report') {
      await runQuery('approvedreports', 'insert', { text: item.data.text, signedBy: req.user.name });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Approval failed' });
  }
});

// Approved Reports
app.get('/approved-reports', async (req, res) => {
  try {
    const reports = await runQuery('approvedreports', 'select');
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

app.post('/approved-reports', authMiddleware, async (req, res) => {
  const { text, file, signedBy } = req.body;
  if (!text || !signedBy) return res.status(400).json({ error: 'Text and signedBy required' });
  try {
    await runQuery('approvedreports', 'insert', { text, file, signedBy });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add report' });
  }
});

// Logs
app.get('/logs', authMiddleware, async (req, res) => {
  try {
    const logs = await runQuery('logs', 'select');
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.post('/logs', authMiddleware, async (req, res) => {
  const { action, details } = req.body;
  try {
    await runQuery('logs', 'insert', { action, by: req.user.name, details, timestamp: new Date().toLocaleString() });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Log failed' });
  }
});

// Notifications
app.get('/notifications', authMiddleware, async (req, res) => {
  const { member } = req.query;
  try {
    const filters = member ? { member } : {};
    const notifications = await runQuery('notifications', 'select', {}, filters);
    res.json(notifications);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/notifications', authMiddleware, async (req, res) => {
  const { message, member } = req.body;
  if (!message || !member) return res.status(400).json({ error: 'Message and member required' });
  try {
    await runQuery('notifications', 'insert', { message, member, read: false });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add notification' });
  }
});

app.patch('/notifications/:id/read', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    await runQuery('notifications', 'update', { read: true }, { id });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Export (CSV for supervisory)
app.get('/export/:type', authMiddleware, async (req, res) => {
  if (req.user.role !== 'supervisorycommittee') return res.status(403).json({ error: 'Unauthorized' });
  const type = req.params.type;
  try {
    const data = await runQuery(type, 'select');
    const csv = [Object.keys(data[0] || {}).join(',')].concat(data.map(row => Object.values(row).join(','))).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}.csv`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ error: 'Export failed' });
  }
});

// Transactions
app.get('/transactions', authMiddleware, async (req, res) => {
  const { member } = req.query;
  try {
    const filters = member ? { member } : {};
    const transactions = await runQuery('transactions', 'select', {}, filters);
    res.json(transactions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.post('/transactions', authMiddleware, async (req, res) => {
  const { title, date, amount, type, member } = req.body;
  if (!title || !amount || !type || !member) return res.status(400).json({ error: 'Required fields missing' });
  try {
    await runQuery('transactions', 'insert', { title, date, amount: parseInt(amount), type, member });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add transaction' });
  }
});

// Signatures
app.get('/signatures', authMiddleware, async (req, res) => {
  try {
    const signatures = await runQuery('signatures', 'select');
    res.json(signatures.reduce((acc, s) => ({ ...acc, [s.role]: s.signature }), {}));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch signatures' });
  }
});

app.post('/signatures', authMiddleware, async (req, res) => {
  const { role, signature } = req.body;
  if (!role || !signature) return res.status(400).json({ error: 'Role and signature required' });
  try {
    await runQuery('signatures', 'insert', { role, signature });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add signature' });
  }
});

// Logout
app.post('/logout', (req, res) => res.json({ success: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
