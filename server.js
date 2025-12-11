require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');

const app = express();
app.use(cors());
app.use(express.json());

const SHEET_ID = '1Hai7HwRk6moq-55LASLrXl8ot8VYwRKgBurJowPm9Ws';  // Your Sheet ID
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_change_in_prod';

// Load service account (your JSON file)
const serviceAccount = require('./sheets-key.json');

// Init doc
const doc = new GoogleSpreadsheet(SHEET_ID);
doc.useServiceAccountAuth(serviceAccount);

// Auth (PIN login from Members tab)
app.post('/api/auth', async (req, res) => {
  const { pin } = req.body;
  try {
    await doc.loadInfo();
    const membersSheet = doc.sheetsByTitle['Members'];
    const rows = await membersSheet.getRows();
    const hashedPin = CryptoJS.SHA256(pin).toString();
    const member = rows.find(row => CryptoJS.SHA256(row.PIN).toString() === hashedPin);
    if (member) {
      const token = jwt.sign({ name: member.Name, email: member.Email }, JWT_SECRET);
      res.json({ user: { name: member.Name, email: member.Email }, token });
    } else {
      res.status(401).json({ error: 'Invalid PIN' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Auth failed' });
  }
});

// News (dashboard comms)
app.get('/api/news', async (req, res) => {
  try {
    await doc.loadInfo();
    const newsSheet = doc.sheetsByTitle['News'];
    const rows = await newsSheet.getRows();
    res.json(rows.map(row => ({ text: row.Text, signedBy: row.SignedBy })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

app.post('/api/news', async (req, res) => {
  const { text, signed_by } = req.body;
  try {
    await doc.loadInfo();
    const newsSheet = doc.sheetsByTitle['News'];
    await newsSheet.addRow({ Text: text, SignedBy: signed_by, CreatedAt: new Date().toLocaleString() });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to post news' });
  }
});

// Welfare (claims)
app.get('/api/welfare', async (req, res) => {
  const { member } = req.query;
  try {
    await doc.loadInfo();
    const welfareSheet = doc.sheetsByTitle['Welfare'];
    const rows = await welfareSheet.getRows();
    const userRows = rows.filter(row => row.Member === member);
    res.json(userRows.map(row => ({ Type: row.Type, Amount: row.Amount, Member: row.Member, Status: row.Status, Date: row.Date })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch welfare' });
  }
});

app.post('/api/welfare', async (req, res) => {
  const { type, amount, member } = req.body;
  try {
    await doc.loadInfo();
    const welfareSheet = doc.sheetsByTitle['Welfare'];
    await welfareSheet.addRow({ Type: type, Amount: amount, Member: member, Status: 'Sec', Date: new Date().toLocaleDateString() });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to submit welfare' });
  }
});

// Polls (elections)
app.get('/api/polls', async (req, res) => {
  try {
    await doc.loadInfo();
    const pollsSheet = doc.sheetsByTitle['Polls'];
    const rows = await pollsSheet.getRows();
    res.json(rows.map(row => ({
      id: row.rowNumber - 1,
      q: row.Question,
      opts: row.Options ? row.Options.split(',') : [],
      votes: row.Votes ? JSON.parse(row.Votes) : [],
      voters: row.Voters ? JSON.parse(row.Voters) : [],
      active: row.Active === 'TRUE'
    })));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});

app.post('/api/polls', async (req, res) => {
  const { question, options } = req.body;
  try {
    await doc.loadInfo();
    const pollsSheet = doc.sheetsByTitle['Polls'];
    await pollsSheet.addRow({
      Question: question,
      Options: options.join(','),
      Votes: JSON.stringify(new Array(options.length).fill(0)),
      Voters: JSON.stringify([]),
      Active: 'TRUE',
      CreatedAt: new Date().toLocaleString()
    });
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Add more endpoints as in previous (transactions, reports, queue, logs, notifications, loans, signatures – same pattern)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
