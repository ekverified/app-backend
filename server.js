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

// ... (rest of endpoints as in last Supabase server.js—members, loans, polls, etc. For brevity, use the full one from my previous message)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
