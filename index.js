
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// --- Database Pool Configuration ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Database Initialization ---
const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    console.log('Connected to the database. Initializing schema...');

    // Drop old bookings table if it exists to ensure clean schema on deploy
    await client.query('DROP TABLE IF EXISTS bookings;');
    console.log('Dropped old "bookings" table (if existed).');

    // Create access_keys table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS access_keys (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        client_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Ensured "access_keys" table exists.');
    
    // Create the new, detailed bookings table
    await client.query(`
      CREATE TABLE bookings (
          id SERIAL PRIMARY KEY,
          access_key VARCHAR(255) NOT NULL,
          package_name VARCHAR(255),
          total_price NUMERIC(10, 2),
          selected_items JSONB,
          wedding_date DATE,
          bride_address TEXT,
          groom_address TEXT,
          locations TEXT,
          schedule TEXT,
          discount_code VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Successfully created new "bookings" table.');

    // Add a sample key if it doesn't exist for testing
    const res = await client.query("SELECT * FROM access_keys WHERE key = '1234'");
    if (res.rowCount === 0) {
      await client.query("INSERT INTO access_keys (key, client_name) VALUES ('1234', 'Test Client')");
      console.log('Inserted sample access key "1234".');
    }
  } catch (err) {
    console.error('Database initialization error!', err.stack);
  } finally {
    client.release();
  }
};


// --- Middleware ---
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = (process.env.CORS_ORIGIN || "").split(',');
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('The CORS policy for this site does not allow access from the specified Origin.'));
    }
  },
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());

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
    if (result.rowCount > 0) {
      res.status(200).json({ valid: true, message: 'Key is valid.' });
    } else {
      res.status(404).json({ valid: false, message: 'Nieprawidłowy klucz dostępu.' });
    }
  } catch (err) {
    console.error('Error validating key:', err);
    res.status(500).json({ message: 'Server error during key validation.' });
  }
});

app.post('/api/bookings', async (req, res) => {
    const {
        accessKey,
        packageName,
        totalPrice,
        selectedItems,
        weddingDate,
        brideAddress,
        groomAddress,
        locations,
        schedule,
        discountCode
    } = req.body;

    if (!accessKey || !packageName || !totalPrice) {
        return res.status(400).json({ message: 'Missing required booking information.' });
    }

    const query = `
        INSERT INTO bookings (
            access_key, package_name, total_price, selected_items, 
            wedding_date, bride_address, groom_address, locations, schedule, discount_code
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id;
    `;
    
    const values = [
        accessKey, packageName, totalPrice, JSON.stringify(selectedItems),
        weddingDate || null, brideAddress || null, groomAddress || null,
        locations || null, schedule || null, discountCode || null
    ];
    
    try {
        const result = await pool.query(query, values);
        const bookingId = result.rows[0].id;
        console.log(`Successfully created booking with ID: ${bookingId}`);
        res.status(201).json({ success: true, bookingId });
    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ success: false, message: 'Server error while creating booking.' });
    }
});


// --- Server Start ---
app.listen(PORT, async () => {
  await initializeDatabase();
  console.log(`API server listening on port ${PORT}`);
});
