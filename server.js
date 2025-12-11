require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const jwt = require('jsonwebtoken');
const CryptoJS = require('crypto-js');

const app = express();
app.use(cors());
app.use(express.json());

const SHEET_ID = '1Hai7HwRk6moq-55LASLrXl8ot8VYwRKgBurJowPm9Ws'; // Matches your Google Sheet
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret_change_in_prod';

// Load service account from env var (stringified JSON)
const serviceAccount = JSON.parse(process.env.SHEETS_KEY_JSON || '{}');

// Optional: Log if auth is missing (for Vercel logs)
if (Object.keys(serviceAccount).length === 0) {
  console.error('WARNING: Missing SHEETS_KEY_JSON env var - Google Sheets auth will fail');
}

// Init doc globally, but don't throw on startup - handle per-route
let doc;
async function initSheets() {
  try {
    doc = new GoogleSpreadsheet(SHEET_ID);
    await doc.useServiceAccountAuth(serviceAccount);
    await doc.loadInfo(); // Test auth early
    console.log('Google Sheets connected successfully');
  } catch (error) {
    console.error('Google Sheets init failed:', error.message);
    // Don't crash the server - routes will handle errors
  }
}

// Call init on startup (non-blocking)
initSheets().catch(err => console.error('Startup Sheets init error:', err));

// Auth (PIN login from Members tab)
app.post('/api/auth', async (req, res) => {
  const { pin } = req.body;
  try {
    if (!doc) await initSheets();
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
    console.error('Auth error:', error);
    res.status(500).json({ error: 'Auth failed - check Sheets access' });
  }
});

// News (dashboard comms)
app.get('/api/news', async (req, res) => {
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const newsSheet = doc.sheetsByTitle['News'];
    const rows = await newsSheet.getRows();
    res.json(rows.map(row => ({ text: row.Text, signedBy: row.SignedBy })));
  } catch (error) {
    console.error('News fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

app.post('/api/news', async (req, res) => {
  const { text, signed_by } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const newsSheet = doc.sheetsByTitle['News'];
    await newsSheet.addRow({ Text: text, SignedBy: signed_by, CreatedAt: new Date().toLocaleString() });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('News post error:', error);
    res.status(500).json({ error: 'Failed to post news' });
  }
});

// Welfare (claims)
app.get('/api/welfare', async (req, res) => {
  const { member } = req.query;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const welfareSheet = doc.sheetsByTitle['Welfare'];
    const rows = await welfareSheet.getRows();
    const userRows = rows.filter(row => row.Member === member);
    res.json(userRows.map(row => ({ Type: row.Type, Amount: row.Amount, Member: row.Member, Status: row.Status, Date: row.Date })));
  } catch (error) {
    console.error('Welfare fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch welfare' });
  }
});

app.post('/api/welfare', async (req, res) => {
  const { type, amount, member } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const welfareSheet = doc.sheetsByTitle['Welfare'];
    await welfareSheet.addRow({ Type: type, Amount: amount, Member: member, Status: 'Sec', Date: new Date().toLocaleDateString() });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Welfare post error:', error);
    res.status(500).json({ error: 'Failed to submit welfare' });
  }
});

// Polls (elections)
app.get('/api/polls', async (req, res) => {
  try {
    if (!doc) await initSheets();
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
    console.error('Polls fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch polls' });
  }
});

app.post('/api/polls', async (req, res) => {
  const { question, options } = req.body;
  try {
    if (!doc) await initSheets();
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
    console.error('Polls post error:', error);
    res.status(500).json({ error: 'Failed to create poll' });
  }
});

// Transactions
app.get('/api/transactions', async (req, res) => {
  const { member } = req.query;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const transactionsSheet = doc.sheetsByTitle['Transactions'];
    const rows = await transactionsSheet.getRows();
    const userRows = rows.filter(row => row.Member === member);
    res.json(userRows.map(row => ({ Title: row.Title, Date: row.Date, Amount: row.Amount, Type: row.Type, Member: row.Member })));
  } catch (error) {
    console.error('Transactions fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

app.post('/api/transactions', async (req, res) => {
  const { title, date, amount, type, member } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const transactionsSheet = doc.sheetsByTitle['Transactions'];
    await transactionsSheet.addRow({ Title: title, Date: date, Amount: amount, Type: type, Member: member });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Transactions post error:', error);
    res.status(500).json({ error: 'Failed to add transaction' });
  }
});

// Approved Reports
app.get('/api/approved-reports', async (req, res) => {
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const reportsSheet = doc.sheetsByTitle['ApprovedReports'];
    const rows = await reportsSheet.getRows();
    res.json(rows.map(row => ({ Text: row.Text, File: row.File, SignedBy: row.SignedBy })));
  } catch (error) {
    console.error('Reports fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

app.post('/api/approved-reports', async (req, res) => {
  const { text, file, signed_by } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const reportsSheet = doc.sheetsByTitle['ApprovedReports'];
    await reportsSheet.addRow({ Text: text, File: file, SignedBy: signed_by });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Reports post error:', error);
    res.status(500).json({ error: 'Failed to add report' });
  }
});

// Chair Queue
app.get('/api/chair-queue', async (req, res) => {
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const queueSheet = doc.sheetsByTitle['ChairQueue'];
    const rows = await queueSheet.getRows();
    res.json(rows.map(row => ({ Type: row.Type, Data: JSON.parse(row.Data || '{}'), Author: row.Author })));
  } catch (error) {
    console.error('Chair queue fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

app.post('/api/chair-queue', async (req, res) => {
  const { type, data, author } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const queueSheet = doc.sheetsByTitle['ChairQueue'];
    await queueSheet.addRow({ Type: type, Data: JSON.stringify(data), Author: author });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Chair queue post error:', error);
    res.status(500).json({ error: 'Failed to add to queue' });
  }
});

app.delete('/api/chair-queue/:rowIndex', async (req, res) => {
  const { rowIndex } = req.params;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const queueSheet = doc.sheetsByTitle['ChairQueue'];
    const rows = await queueSheet.getRows();
    const row = rows[rowIndex];
    await row.del();
    res.json({ success: true });
  } catch (error) {
    console.error('Chair queue delete error:', error);
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// Logs
app.get('/api/logs', async (req, res) => {
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const logsSheet = doc.sheetsByTitle['Logs'];
    const rows = await logsSheet.getRows();
    res.json(rows.map(row => ({ Action: row.Action, By: row.By, Details: row.Details, Timestamp: row.Timestamp })));
  } catch (error) {
    console.error('Logs fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

app.post('/api/logs', async (req, res) => {
  const { action, by, details } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const logsSheet = doc.sheetsByTitle['Logs'];
    await logsSheet.addRow({ Action: action, By: by, Details: details, Timestamp: new Date().toLocaleString() });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Logs post error:', error);
    res.status(500).json({ error: 'Failed to log' });
  }
});

// Notifications
app.get('/api/notifications', async (req, res) => {
  const { member } = req.query;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const notifsSheet = doc.sheetsByTitle['Notifications'];
    const rows = await notifsSheet.getRows();
    const userRows = rows.filter(row => row.Member === member);
    res.json(userRows.map(row => ({ Message: row.Message, Read: row.Read === 'TRUE' })));
  } catch (error) {
    console.error('Notifications fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

app.post('/api/notifications', async (req, res) => {
  const { message, member } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const notifsSheet = doc.sheetsByTitle['Notifications'];
    await notifsSheet.addRow({ Message: message, Member: member, Read: 'FALSE' });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Notifications post error:', error);
    res.status(500).json({ error: 'Failed to add notification' });
  }
});

app.patch('/api/notifications/:rowIndex/read', async (req, res) => {
  const { rowIndex } = req.params;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const notifsSheet = doc.sheetsByTitle['Notifications'];
    const rows = await notifsSheet.getRows();
    const row = rows[rowIndex];
    row.Read = 'TRUE';
    await row.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Notifications patch error:', error);
    res.status(500).json({ error: 'Failed to mark read' });
  }
});

// Loans
app.get('/api/loans', async (req, res) => {
  const { member } = req.query;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const loansSheet = doc.sheetsByTitle['Loans'];
    const rows = await loansSheet.getRows();
    const userRows = rows.filter(row => row.Member === member);
    res.json(userRows.map(row => ({ Amount: row.Amount, Purpose: row.Purpose, Member: row.Member, Status: row.Status, Date: row.Date })));
  } catch (error) {
    console.error('Loans fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

app.post('/api/loans', async (req, res) => {
  const { amount, purpose, member } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const loansSheet = doc.sheetsByTitle['Loans'];
    await loansSheet.addRow({ Amount: amount, Purpose: purpose, Member: member, Status: 'Pending', Date: new Date().toLocaleDateString() });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Loans post error:', error);
    res.status(500).json({ error: 'Failed to submit loan' });
  }
});

// Signatures
app.get('/api/signatures', async (req, res) => {
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const sigsSheet = doc.sheetsByTitle['Signatures'];
    const rows = await sigsSheet.getRows();
    res.json(rows.reduce((acc, row) => ({ ...acc, [row.Role]: row.Signature }), {}));
  } catch (error) {
    console.error('Signatures fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch signatures' });
  }
});

app.patch('/api/signatures/:role', async (req, res) => {
  const { role } = req.params;
  const { signature } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const sigsSheet = doc.sheetsByTitle['Signatures'];
    const rows = await sigsSheet.getRows();
    const row = rows.find(r => r.Role === role);
    if (row) {
      row.Signature = signature;
      await row.save();
    } else {
      await sigsSheet.addRow({ Role: role, Signature: signature });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Signatures patch error:', error);
    res.status(500).json({ error: 'Failed to update signature' });
  }
});

// Members (admin add/remove)
app.post('/api/members', async (req, res) => {
  const { name, email, pin } = req.body;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const membersSheet = doc.sheetsByTitle['Members'];
    await membersSheet.addRow({ Name: name, Email: email, PIN: pin });
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Members post error:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
});

app.delete('/api/members/:name', async (req, res) => {
  const { name } = req.params;
  try {
    if (!doc) await initSheets();
    await doc.loadInfo();
    const membersSheet = doc.sheetsByTitle['Members'];
    const rows = await membersSheet.getRows();
    const row = rows.find(r => r.Name === name);
    if (row) {
      await row.del();
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Members delete error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on port ${PORT}`));
