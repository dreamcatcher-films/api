
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// --- Database Connection Pool ---
// Render requires SSL for its PostgreSQL connections
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

// --- Database Initialization ---
// This function runs on startup to ensure our table exists.
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // Check if the table exists by trying to cast its name to a registration class.
    // This will throw an error if the table does not exist.
    await client.query("SELECT 'access_keys'::regclass");
    console.log('Database table "access_keys" already exists. Skipping initialization.');
  } catch (err) {
    // If the table doesn't exist, the query above fails.
    console.log('Table "access_keys" not found. Initializing database schema...');
    const setupQuery = `
      CREATE TABLE access_keys (
          id SERIAL PRIMARY KEY,
          key VARCHAR(255) UNIQUE NOT NULL,
          client_name VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );

      -- Insert a sample key for testing, so we can check if it works
      INSERT INTO access_keys (key, client_name) VALUES ('1234', 'Test Client');
    `;
    await client.query(setupQuery);
    console.log('Database initialized successfully.');
  } finally {
    // VERY IMPORTANT: Release the client back to the pool.
    client.release();
  }
}

// --- Middleware ---
// Enable CORS for your frontend application
const corsOptions = {
  origin: process.env.CORS_ORIGIN, // e.g., 'https://your-pwa-on-vercel.app'
};
app.use(cors(corsOptions));
app.use(express.json()); // To parse JSON bodies

// --- API Endpoints ---
app.get('/', (req, res) => {
  res.send('Dreamcatcher API is running!');
});

app.post('/api/validate-key', async (req, res) => {
  const { key } = req.body;

  if (!key) {
    return res.status(400).json({ message: 'Access key is required.' });
  }

  try {
    const result = await pool.query('SELECT * FROM access_keys WHERE key = $1', [key]);
    if (result.rows.length > 0) {
      res.status(200).json({ message: 'Key is valid.' });
    } else {
      res.status(403).json({ message: 'Nieprawidłowy klucz dostępu.' });
    }
  } catch (error) {
    console.error('Error validating key:', error);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

// --- Start Server ---
// We initialize the database first, then start listening for requests.
initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`API server listening on port ${port}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database or start server:', err);
    process.exit(1); // Exit if we can't connect to the DB
  });
