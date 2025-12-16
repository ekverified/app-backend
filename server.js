require('dotenv').config();
const express = require('express');
const { Octokit } = require('@octokit/core');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');
const app = express();
const port = process.env.PORT || 10000;

// Middleware
app.use(cors({ origin: ['https://ekverified.github.io', 'https://your-frontend.onrender.com'] }));  // Add Render URL
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// GitHub setup (unchanged except retries)
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const owner = process.env.GITHUB_OWNER || 'ekverified';
const repo = process.env.GITHUB_REPO || 'i8-allinone-data';
const basePath = '';

// ... (keep getData, saveData, sleep, checkTokenScopes, initData as is)

// Auth Middleware (unchanged)

// Auth endpoints (keep /auth, add /auth/admin-pin)
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

// ... (keep all existing endpoints: members, news, loans, welfare, polls, chair-queue, approved-reports, upload-docs, logs, notifications, transactions, signatures)

// Add missing: handover
app.post('/handover', authMiddleware, async (req, res) => {
  if (req.user.role !== 'chairperson') return res.status(403).json({ error: 'Chair only' });
  const { role, name, signature } = req.body;
  if (!role || !name || !signature) return res.status(400).json({ error: 'Invalid input' });
  try {
    const members = await getData('Members.json');
    const member = members.find(m => m.name === name);  // Or email
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

// Add polls PATCH for voting
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

// Health (unchanged)
app.get('/health', (req, res) => res.json({ status: 'OK', message: 'i8 Backend Running' }));

initData().catch(console.error);

app.listen(port, () => console.log(`Server on port ${port}`));
