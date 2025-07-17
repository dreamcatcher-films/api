
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 10000;

// --- Database Connection Pool ---
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
        // Check for access_keys table
        const accessKeysTableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'access_keys'
            );
        `);

        if (!accessKeysTableExists.rows[0].exists) {
            console.log('Table "access_keys" not found. Initializing...');
            await client.query(`
                CREATE TABLE access_keys (
                    id SERIAL PRIMARY KEY,
                    key VARCHAR(255) UNIQUE NOT NULL,
                    client_name VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);
            await client.query(`
                INSERT INTO access_keys (key, client_name) VALUES ('1234', 'Test Client');
            `);
            console.log('Table "access_keys" initialized successfully.');
        }

        // Check for bookings table (NEW AND UPDATED LOGIC)
        const bookingsTableExists = await client.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'bookings'
            );
        `);

        if (!bookingsTableExists.rows[0].exists) {
            console.log('Table "bookings" not found. Initializing...');
            await client.query(`
                CREATE TABLE bookings (
                    id SERIAL PRIMARY KEY,
                    access_key_used VARCHAR(255) NOT NULL,
                    package_name VARCHAR(255),
                    total_price NUMERIC(10, 2),
                    selected_items TEXT[],
                    wedding_date DATE,
                    bride_address TEXT,
                    groom_address TEXT,
                    locations TEXT,
                    schedule TEXT,
                    discount_code VARCHAR(255),
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );
            `);
            console.log('Table "bookings" initialized successfully.');
        }

    } catch (err) {
        console.error('Error during database initialization:', err);
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
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
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
        if (result.rows.length > 0) {
            res.status(200).json({ valid: true });
        } else {
            res.status(404).json({ message: 'Nieprawidłowy klucz dostępu.' });
        }
    } catch (err) {
        console.error('Error validating key:', err);
        res.status(500).json({ message: 'Błąd serwera podczas weryfikacji klucza.' });
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

    // Basic validation
    if (!accessKey || !packageName || !totalPrice) {
        return res.status(400).json({ message: 'Missing required booking information.' });
    }

    try {
        const query = `
            INSERT INTO bookings (
                access_key_used, package_name, total_price, selected_items, wedding_date, 
                bride_address, groom_address, locations, schedule, discount_code
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING id;
        `;
        const values = [
            accessKey, packageName, totalPrice, selectedItems, weddingDate || null, 
            brideAddress, groomAddress, locations, schedule, discountCode
        ];
        
        const result = await pool.query(query, values);
        const newBookingId = result.rows[0].id;

        res.status(201).json({ success: true, bookingId: newBookingId });

    } catch (err) {
        console.error('Error creating booking:', err);
        res.status(500).json({ message: 'Błąd serwera podczas tworzenia rezerwacji.' });
    }
});


// --- Server Start ---
app.listen(port, async () => {
    await initializeDatabase();
    console.log(`API server listening on port ${port}`);
});
