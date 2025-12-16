require('dotenv').config();
const express = require('express');
const { Octokit } = require('@octokit/core');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');

const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(cors({ origin: ['https://ekverified.github.io', 'https://your-frontend.onrender.com', 'https://i8-frontend.onrender.com'] })); // Add your frontend URLs
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// GitHub API setup
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_OWNER || 'ekverified';
const repo = process.env.GITHUB_REPO || 'i8-backend';
const basePath = ''; // Root

// Utility delay
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Check token scopes
async function checkTokenScopes() {
  try {
    const response = await octokit.request('GET /rate_limit');
    const scopes = response.headers['x-oauth-scopes'] || '';
    console.log('GitHub scopes:', scopes);
    if (!scopes.includes('repo')) throw new Error('GITHUB_TOKEN lacks "repo" scope');
  } catch (error) {
    console.error('Token scopes failed:', error.message);
    throw error;
  }
}

// Get JSON file
async function getData(file) {
  const maxRetries = 3;
  let attempt = 1;
  while (attempt <= maxRetries) {
    try {
      const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner, repo, path: file });
      const content = Buffer.from(response.data.content, 'base64').toString('utf8');
      const parsedData = JSON.parse(content);
      console.log(`getData ${file} - Success`);
      return parsedData;
    } catch (error) {
      console.error(`getData ${file} - Attempt ${attempt} failed:`, error.message);
      if (attempt === maxRetries) throw new Error(`Failed to read ${file}: ${error.message}`);
      await sleep(1000 * attempt);
      attempt++;
    }
  }
}

// Save JSON file
async function saveData(file, data, commitMessage) {
  try {
    const response = await octokit.request('GET /repos/{owner}/{repo}/contents/{path}', { owner, repo, path: file });
    const sha = response.data.sha;
    const content = JSON.stringify(data, null, 2);
    await octokit.request('PUT /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: file,
      message: commitMessage,
      content: Buffer.from(content).toString('base64'),
      sha
    });
    console.log(`Saved ${file}: ${commitMessage}`);
  } catch (error) {
    console.error(`Failed to save ${file}:`, error.message);
    throw error;
  }
}

// Init defaults if empty
async function initData() {
  await checkTokenScopes();
  const files = ['Members.json', 'Loans.json', 'News.json', 'Welfare.json', 'Polls.json', 'Transactions.json', 'ChairQueue.json', 'Logs.json', 'Notifications.json', 'AprovedReports.json', 'Docs.json', 'Signatures.json'];
  for (const file of files) {
    try {
      await getData(file);
    } catch (error) {
      if (error.message.includes('404')) {
        const initial = file.includes('Signatures') || file.includes('Docs') ? {} : [];
        await saveData(file, initial, `Init ${file} for i8 All-In-One App`);
      }
    }
  }
  // Add defaults to Members
  const members = await getData('Members.json');
  if (!members.length) {
    const defaults = [
      { id: 1, name: 'Felix', email: 'felix@example.com', hashedpin: CryptoJS.SHA256('1234').toString(), role: 'member' },
      { id: 2, name: 'enoch thumbi', email: 'thumbikamauenoch0@gmail.com', hashedpin: CryptoJS.SHA256('3333').toString(), role: 'chairperson' }
    ];
    await saveData('Members.json', defaults, 'Add defaults for i8 All-In-One App');
  }
}
initData().catch(console.error);

// Auth Middleware (DEFINED HERE - BEFORE ROUTES)
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET || 'supersecret');
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
    const members = await getData('Members.json');
    const member = members.find(m => m.email === email);
    if (!member) return res.status(401).json({ error: 'Invalid Email or PIN' });
    const hashedPin = CryptoJS.SHA256(pin).toString();
    if (member.hashedpin === hashedPin) {
      const token = jwt.sign({ name: member.name, email, role: member.role }, process.env.JWT_SECRET || 'supersecret', { expiresIn: '1h' });
      res.json({ user: { name: member.name, email, role: member.role }, token });
    } else {
      res.status(401).json({ error: 'Invalid Email or PIN' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Auth failed' });
  }
});

// Admin PIN Auth
app.post('/auth/admin-pin', async (req, res) => {
  const { pin } = req.body;
  if (!pin || pin !== process.env.ADMIN_PIN || pin.length !== 4) return res.status(401).json({ error: 'Invalid admin PIN' });
  try {
    const token = jwt.sign({ admin: true }, process.env.JWT_SECRET || 'supersecret', { expiresIn: '1h' });
    res.json({ token });
  } catch {
    res.status(500).json({ error: 'Auth failed' });
  }
});

// Reset PIN
app.post('/reset-pin', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });
  try {
    const members = await getData('Members.json');
    const member = members.find(m => m.email === email);
    if (!member) return res.status(400).json({ error: 'User not found' });
    const newPin = '1234';
    member.hashedpin = CryptoJS.SHA256(newPin).toString();
    await saveData('Members.json', members, `Reset PIN for ${email} in i8 All-In-One App`);
    res.json({ success: true, message: 'PIN reset to 1234' });
  } catch (error) {
    res.status(500).json({ error: 'Reset failed' });
  }
});

// Members
app.get('/members', authMiddleware, async (req, res) => {
  try {
    const { role } = req.query;
    const members = await getData('Members.json');
    const filtered = role ? members.filter(m => m.role === role) : members;
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch members' });
  }
});

app.post('/members', async (req, res) => {
  const { name, email, pin } = req.body;
  if (!name || !email || !pin || pin.length !== 4) return res.status(400).json({ error: 'Invalid input' });
  try {
    const members = await getData('Members.json');
    if (members.find(m => m.email === email)) return res.status(409).json({ error: 'User exists' });
    const hashedPin = CryptoJS.SHA256(pin).toString();
    const newMember = { id: members.length + 1, name, email, hashedpin: hashedPin, role: 'member' };
    members.push(newMember);
    await saveData('Members.json', members, `Add member ${name} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add member' });
  }
});

app.put('/members/:email', authMiddleware, async (req, res) => {
  const { email: targetEmail } = req.params;
  const { name, newPin } = req.body;
  if (req.user.email !== targetEmail && req.user.role !== 'chairperson') return res.status(403).json({ error: 'Unauthorized' });
  try {
    const members = await getData('Members.json');
    const member = members.find(m => m.email === targetEmail);
    if (!member) return res.status(404).json({ error: 'User not found' });
    if (name) member.name = name.trim();
    if (newPin && newPin.length === 4) member.hashedpin = CryptoJS.SHA256(newPin).toString();
    await saveData('Members.json', members, `Update member ${targetEmail} in i8 All-In-One App`);
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
    const members = await getData('Members.json');
    const member = members.find(m => m.email === targetEmail);
    if (!member) return res.status(404).json({ error: 'User not found' });
    member.role = role;
    await saveData('Members.json', members, `Promote ${targetEmail} to ${role} in i8 All-In-One App`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Promotion failed' });
  }
});

// News
app.get('/news', async (req, res) => {
  try {
    const news = await getData('News.json');
    res.json(news);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

app.post('/news', authMiddleware, async (req, res) => {
  const { text, signed_by } = req.body;
  if (!text || !signed_by) return res.status(400).json({ error: 'Text and signed_by required' });
  try {
    const news = await getData('News.json');
    news.push({ id: news.length + 1, text, signedBy: signed_by, createdAt: new Date().toISOString() });
    await saveData('News.json', news, `Add news by ${signed_by} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post news' });
  }
});

// Loans
app.get('/loans', authMiddleware, async (req, res) => {
  const { member, status } = req.query;
  try {
    const loans = await getData('Loans.json');
    let filtered = loans;
    if (member) filtered = filtered.filter(l => l.member === member);
    if (status) filtered = filtered.filter(l => l.status === status);
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

app.post('/loans', authMiddleware, async (req, res) => {
  const { amount, purpose, member } = req.body;
  if (!amount || !purpose || !member) return res.status(400).json({ error: 'Invalid input' });
  try {
    const loans = await getData('Loans.json');
    const id = Date.now();
    loans.push({ id, amount: parseInt(amount), purpose, member, status: 'Pending', date: new Date().toLocaleDateString() });
    await saveData('Loans.json', loans, `Add loan for ${member} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit loan' });
  }
});

app.patch('/loans/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!['treasurer', 'secretary', 'chairperson'].includes(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
  try {
    const loans = await getData('Loans.json');
    const loan = loans.find(l => l.id === parseInt(id));
    if (!loan) return res.status(404).json({ error: 'Loan not found' });
    loan.status = status;
    await saveData('Loans.json', loans, `Update loan ${id} status to ${status} in i8 All-In-One App`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Welfare
app.get('/welfare', authMiddleware, async (req, res) => {
  const { member } = req.query;
  try {
    const welfare = await getData('Welfare.json');
    let filtered = welfare;
    if (member) filtered = filtered.filter(w => w.member === member);
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch welfare' });
  }
});

app.post('/welfare', authMiddleware, async (req, res) => {
  const { type, amount, member } = req.body;
  if (!type || !amount || !member) return res.status(400).json({ error: 'Invalid input' });
  try {
    const welfare = await getData('Welfare.json');
    welfare.push({ id: welfare.length + 1, type, amount: parseInt(amount), member, status: 'Pending', date: new Date().toLocaleDateString() });
    await saveData('Welfare.json', welfare, `Add welfare claim for ${member} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit welfare' });
  }
});

// Polls
app.get('/polls', async (req, res) => {
  try {
    const polls = await getData('Polls.json');
    res.json(polls);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});

app.post('/polls', authMiddleware, async (req, res) => {
  const { question, options } = req.body;
  if (!question || !options || options.length < 2) return res.status(400).json({ error: 'Invalid input' });
  try {
    const polls = await getData('Polls.json');
    const id = polls.length + 1;
    polls.push({ id, question, options, votes: new Array(options.length).fill(0), voters: [], active: true, createdAt: new Date().toLocaleString() });
    await saveData('Polls.json', polls, `Add poll ${question} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

app.patch('/polls/:id', authMiddleware, async (req, res) => {
  if (req.user.role !== 'member' && req.user.role !== 'secretary') return res.status(403).json({ error: 'Unauthorized' });
  const { id } = req.params;
  const { votes, voters } = req.body;
  try {
    const polls = await getData('Polls.json');
    const poll = polls.find(p => p.id === parseInt(id));
    if (!poll) return res.status(404).json({ error: 'Poll not found' });
    if (poll.voters.includes(req.user.email)) return res.status(400).json({ error: 'Already voted' });
    poll.votes = votes;
    poll.voters = voters;
    await saveData('Polls.json', polls, `Update poll ${id} votes`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Chair Queue
app.get('/chair-queue', authMiddleware, async (req, res) => {
  try {
    const queue = await getData('ChairQueue.json');
    res.json(queue);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

app.post('/chair-queue', authMiddleware, async (req, res) => {
  const { type, data, author } = req.body;
  if (!type || !author) return res.status(400).json({ error: 'Invalid input' });
  try {
    const queue = await getData('ChairQueue.json');
    const id = Date.now().toString();
    queue.push({ id, type, data, author, status: 'Pending', createdAt: new Date().toLocaleString() });
    await saveData('ChairQueue.json', queue, `Add queue item ${type} by ${author} in i8 All-In-One App`);
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
    const queue = await getData('ChairQueue.json');
    const item = queue.find(q => q.id === id);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    item.status = 'Approved';
    if (signature) item.signature = signature;
    await saveData('ChairQueue.json', queue, `Approve queue ${id} in i8 All-In-One App`);
    // Auto-publish if minutes
    if (item.type === 'Minutes') {
      const news = await getData('News.json');
      news.push({ id: news.length + 1, text: item.data.text, signedBy: req.user.name, createdAt: new Date().toLocaleString() });
      await saveData('News.json', news, `Publish minutes from queue in i8 All-In-One App`);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Approval failed' });
  }
});

// Approved Reports
app.get('/approved-reports', async (req, res) => {
  try {
    const reports = await getData('AprovedReports.json');
    res.json(reports);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

app.post('/approved-reports', authMiddleware, async (req, res) => {
  const { text, file, signedBy } = req.body;
  if (!text || !signedBy) return res.status(400).json({ error: 'Invalid input' });
  try {
    const reports = await getData('AprovedReports.json');
    reports.push({ id: reports.length + 1, text, file, signedBy });
    await saveData('AprovedReports.json', reports, `Add report by ${signedBy} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add report' });
  }
});

// Docs Upload
app.post('/upload-docs', authMiddleware, async (req, res) => {
  const { fileName, fileData, signedBy } = req.body;
  if (!fileName || !fileData || !signedBy) return res.status(400).json({ error: 'Invalid input' });
  try {
    const docs = await getData('Docs.json');
    docs[fileName] = { data: fileData, signedBy, uploadedAt: new Date().toISOString() };
    await saveData('Docs.json', docs, `Upload doc ${fileName} by ${signedBy} in i8 All-In-One App`);
    res.status(201).json({ success: true, message: 'Document uploaded' });
  } catch (error) {
    res.status(500).json({ error: 'Upload failed' });
  }
});

app.get('/docs', authMiddleware, async (req, res) => {
  try {
    const docs = await getData('Docs.json');
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch docs' });
  }
});

// Logs
app.get('/logs', authMiddleware, async (req, res) => {
  try {
    const logs = await getData('Logs.json');
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.post('/logs', authMiddleware, async (req, res) => {
  const { action, details } = req.body;
  try {
    const logs = await getData('Logs.json');
    logs.push({ id: logs.length + 1, action, by: req.user.name, details, timestamp: new Date().toLocaleString() });
    await saveData('Logs.json', logs, `Add log ${action} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Log failed' });
  }
});

// Notifications
app.get('/notifications', authMiddleware, async (req, res) => {
  const { member } = req.query;
  try {
    const notifications = await getData('Notifications.json');
    let filtered = notifications;
    if (member) filtered = filtered.filter(n => n.member === member);
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/notifications', authMiddleware, async (req, res) => {
  const { message, member } = req.body;
  if (!message || !member) return res.status(400).json({ error: 'Invalid input' });
  try {
    const notifications = await getData('Notifications.json');
    notifications.push({ id: notifications.length + 1, message, member, read: false });
    await saveData('Notifications.json', notifications, `Add notification for ${member} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add notification' });
  }
});

app.patch('/notifications/:id/read', authMiddleware, async (req, res) => {
  const { id } = req.params;
  try {
    const notifications = await getData('Notifications.json');
    const notification = notifications.find(n => n.id === parseInt(id));
    if (!notification) return res.status(404).json({ error: 'Not found' });
    notification.read = true;
    await saveData('Notifications.json', notifications, `Mark notification ${id} read in i8 All-In-One App`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Update failed' });
  }
});

// Transactions
app.get('/transactions', authMiddleware, async (req, res) => {
  const { member } = req.query;
  try {
    const transactions = await getData('Transactions.json');
    let filtered = transactions;
    if (member) filtered = filtered.filter(t => t.member === member);
    res.json(filtered);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.post('/transactions', authMiddleware, async (req, res) => {
  const { title, date, amount, type, member } = req.body;
  if (!title || !amount || !type || !member) return res.status(400).json({ error: 'Invalid input' });
  try {
    const transactions = await getData('Transactions.json');
    transactions.push({ id: transactions.length + 1, title, date, amount: parseInt(amount), type, member });
    await saveData('Transactions.json', transactions, `Add transaction for ${member} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add transaction' });
  }
});

// Signatures
app.get('/signatures', authMiddleware, async (req, res) => {
  try {
    const signatures = await getData('Signatures.json');
    res.json(signatures);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch signatures' });
  }
});

app.post('/signatures', authMiddleware, async (req, res) => {
  const { role, signature } = req.body;
  if (!role || !signature) return res.status(400).json({ error: 'Invalid input' });
  try {
    const signatures = await getData('Signatures.json');
    signatures[role] = signature;
    await saveData('Signatures.json', signatures, `Add signature for ${role} in i8 All-In-One App`);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add signature' });
  }
});

// Handover (NEW - Protected by authMiddleware)
app.post('/handover', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chairperson') return res.status(403).json({ error: 'Chair only' });
  const { role, name, signature } = req.body;
  if (!role || !name || !signature) return res.status(400).json({ error: 'Invalid input' });
  try {
    const members = await getData('Members.json');
    const member = members.find(m => m.name === name); // Or use email if preferred
    if (!member) return res.status(404).json({ error: 'Member not found' });
    member.role = role;
    // Update signature
    const signatures = await getData('Signatures.json');
    signatures[role] = signature;
    await saveData('Signatures.json', signatures, `Update signature for ${role}`);
    await saveData('Members.json', members, `Handover ${role} to ${name}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Handover failed' });
  }
});

// Logout
app.post('/logout', (req, res) => res.json({ success: true }));

// Health
app.get('/health', (req, res) => res.json({ status: 'OK', message: 'i8 All-In-One App Backend Running' }));

app.listen(port, () => console.log(`i8 All-In-One App Backend on port ${port}`));
