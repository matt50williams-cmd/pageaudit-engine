const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../pageaudit.db');
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    email TEXT,
    pageUrl TEXT,
    reviewType TEXT,
    goals TEXT,
    postingFrequency TEXT,
    contentType TEXT,
    struggles TEXT,
    extraNotes TEXT,
    createdAt TEXT
  )
`);

module.exports = db;