
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    // Check for 'access_keys' table
    try {
      await client.query("SELECT 'access_keys'::regclass");
      console.log('Table "access_keys" already exists.');
    } catch (err) {
      console.log('Table "access_keys" not found. Creating...');
      const setupAccessKeysTable = `
        CREATE TABLE access_keys (
            id SERIAL PRIMARY KEY,
            key VARCHAR(255) UNIQUE NOT NULL,
            client_name VARCHAR(255),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO access_keys (key, client_name) VALUES ('1234', 'Test Client');
      `;
      await client.query(setupAccessKeysTable);
      console.log('Table "access_keys" created successfully.');
    }
    
    // Check for 'bookings' table
    try {
      await client.query("SELECT 'bookings'::regclass");
      console.log('Table "bookings" already exists.');
    } catch (err) {
      console.log('Table "bookings" not found. Creating...');
      const setupBookingsTable = `
        CREATE TABLE bookings (
          id SERIAL PRIMARY KEY,
          access_key_id INTEGER REFERENCES access_keys(id),
          package_name VARCHAR(255) NOT NULL,
          total_price NUMERIC(10, 2) NOT NULL,
          selected_items JSONB,
          status VARCHAR(50) DEFAULT 'pending',
          booking_date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
      `;
      await client.query(setupBookingsTable);
      console.log('Table "bookings" created successfully.');
    }

  } catch (err) {
      console.error('Error during database initialization:', err);
      // We don't exit here, to allow the server to start even if DB init fails.
      // The endpoints will likely fail, but the server will run.
  } finally {
    client.release();
  }
}

const corsOptions = {
  origin: process.env.CORS_ORIGIN,
};
app.use(cors(corsOptions));
app.use(express.json());

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

app.post('/api/bookings', async (req, res) => {
    const { accessKey, packageName, totalPrice, selectedItems } = req.body;

    if (!accessKey || !packageName || totalPrice === undefined || !selectedItems) {
        return res.status(400).json({ message: 'Missing required booking information.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN'); // Start transaction

        // 1. Validate key and get its ID
        const keyResult = await client.query('SELECT id FROM access_keys WHERE key = $1', [accessKey]);
        if (keyResult.rows.length === 0) {
            return res.status(403).json({ message: 'Invalid access key for booking.' });
        }
        const accessKeyId = keyResult.rows[0].id;

        // 2. Insert the new booking
        const insertQuery = `
            INSERT INTO bookings (access_key_id, package_name, total_price, selected_items, status)
            VALUES ($1, $2, $3, $4, 'pending')
            RETURNING id;
        `;
        const bookingResult = await client.query(insertQuery, [accessKeyId, packageName, totalPrice, JSON.stringify(selectedItems)]);
        const newBookingId = bookingResult.rows[0].id;

        await client.query('COMMIT'); // Commit transaction
        
        res.status(201).json({ message: 'Booking created successfully.', bookingId: newBookingId });

    } catch (error) {
        await client.query('ROLLBACK'); // Rollback on error
        console.error('Error creating booking:', error);
        res.status(500).json({ message: 'Internal server error during booking creation.' });
    } finally {
        client.release();
    }
});


initializeDatabase()
  .then(() => {
    app.listen(port, () => {
      console.log(`API server listening on port ${port}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database or start server:', err);
    process.exit(1);
  });
