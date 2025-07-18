
import 'dotenv/config';
import express from 'express';
import { Pool } from 'pg';
import cors from 'cors';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
import jwt from 'jsonwebtoken';
import { put, del } from '@vercel/blob';

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key-for-dev';
const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'your-default-super-secret-admin-key-for-dev';

// --- Database Pool Configuration ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// --- Helper Functions ---
const generateUniqueClientId = async (client) => {
    let isUnique = false;
    let clientId;
    while (!isUnique) {
        clientId = Math.floor(1000 + Math.random() * 9000).toString();
        const res = await client.query('SELECT id FROM bookings WHERE client_id = $1', [clientId]);
        if (res.rowCount === 0) {
            isUnique = true;
        }
    }
    return clientId;
};

// --- Database Initialization ---
const initializeDatabase = async () => {
  const client = await pool.connect();
  try {
    console.log('Connected to the database. Initializing schema...');

    await client.query(`
      CREATE TABLE IF NOT EXISTS access_keys (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        client_name VARCHAR(255),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Ensured "access_keys" table exists.');
    
    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
          id SERIAL PRIMARY KEY,
          client_id VARCHAR(4) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          access_key VARCHAR(255) NOT NULL,
          package_name VARCHAR(255),
          total_price NUMERIC(10, 2),
          selected_items JSONB,
          bride_name VARCHAR(255),
          groom_name VARCHAR(255),
          wedding_date DATE,
          bride_address TEXT,
          groom_address TEXT,
          locations TEXT,
          schedule TEXT,
          email VARCHAR(255) NOT NULL,
          phone_number VARCHAR(255) NOT NULL,
          additional_info TEXT,
          discount_code VARCHAR(255),
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Ensured "bookings" table exists.');
    
     await client.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('Ensured "admins" table exists.');
    
    await client.query(`
        CREATE TABLE IF NOT EXISTS availability (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            start_time TIMESTAMP WITH TIME ZONE NOT NULL,
            end_time TIMESTAMP WITH TIME ZONE NOT NULL,
            is_all_day BOOLEAN DEFAULT FALSE,
            description TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('Ensured "availability" table exists.');

    await client.query(`
        CREATE TABLE IF NOT EXISTS galleries (
            id SERIAL PRIMARY KEY,
            title VARCHAR(255) NOT NULL,
            description TEXT,
            image_url VARCHAR(255) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
        );
    `);
    console.log('Ensured "galleries" table exists.');

    // Add a sample key if it doesn't exist for testing
    const resKeys = await client.query("SELECT * FROM access_keys WHERE key = '1234'");
    if (resKeys.rowCount === 0) {
      await client.query("INSERT INTO access_keys (key, client_name) VALUES ('1234', 'Test Client')");
      console.log('Inserted sample access key "1234".');
    }
    
    // Create default admin user if none exists
    const resAdmins = await client.query("SELECT * FROM admins");
    if (resAdmins.rowCount === 0) {
        const adminEmail = 'admin@dreamcatcher.com';
        const adminPassword = 'admin' + Math.floor(1000 + Math.random() * 9000); // Generate a random password
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(adminPassword, salt);
        await client.query("INSERT INTO admins (email, password_hash) VALUES ($1, $2)", [adminEmail, passwordHash]);
        console.log('============================================');
        console.log('CREATED DEFAULT ADMIN USER:');
        console.log(`Email: ${adminEmail}`);
        console.log(`Password: ${adminPassword}`);
        console.log('Please use these credentials to log in to the admin panel.');
        console.log('============================================');
    }

    // Add a sample booking for testing if it doesn't exist
    const testClientId = '9999';
    const resTestBooking = await client.query("SELECT * FROM bookings WHERE client_id = $1", [testClientId]);
    if (resTestBooking.rowCount === 0) {
        console.log('Creating a sample booking for testing purposes...');
        const testPassword = 'password123';
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(testPassword, salt);
        
        const query = `
            INSERT INTO bookings (
                client_id, password_hash, access_key, package_name, total_price, selected_items,
                bride_name, groom_name, wedding_date, bride_address, groom_address, locations, schedule, 
                email, phone_number, additional_info, discount_code
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        `;
        const values = [
            testClientId, passwordHash, '1234', 'Pakiet Złoty', 5500.00, 
            JSON.stringify(["film", "photos", "drone", "pre_wedding"]),
            'Janina Testowa', 'Krzysztof Przykładowy', '2025-07-26', 
            'ul. Testowa 1, 00-001 Warszawa', 'ul. Przykładowa 2, 00-002 Kraków',
            'Kościół: Katedra Polowa WP, Sala: Zamek Ujazdowski', 
            '14:00 - Ceremonia\n16:00 - Wesele', 
            'test@example.com', '555-444-333',
            'Prosimy o ujęcia detali i dużo spontanicznych kadrów.', null
        ];

        await client.query(query, values);
        console.log('============================================');
        console.log('CREATED A TEST BOOKING:');
        console.log(`Client ID: ${testClientId}`);
        console.log(`Password: ${testPassword}`);
        console.log('You can use these credentials to log in to the client panel.');
        console.log('============================================');
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
    const allowedOriginsStr = process.env.CORS_ORIGIN;
    if (!allowedOriginsStr) {
      return callback(null, true);
    }
    const allowedOrigins = allowedOriginsStr.split(',');
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('The CORS policy for this site does not allow access from the specified Origin.'));
    }
  },
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Increase limit for base64 uploads

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401);

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

const authenticateAdminToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token == null) return res.sendStatus(401);

    jwt.verify(token, ADMIN_JWT_SECRET, (err, admin) => {
        if (err) return res.sendStatus(403);
        req.admin = admin;
        next();
    });
};


// --- API Endpoints ---
app.get('/', (req, res) => {
  res.send('Dreamcatcher API is running!');
});

// --- GALLERY Endpoints (PUBLIC) ---
app.get('/api/gallery', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM galleries ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching public gallery:', err);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania galerii.' });
    }
});


// --- CLIENT Endpoints ---
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
        accessKey, password, packageName, totalPrice, selectedItems,
        brideName, groomName, weddingDate, brideAddress, groomAddress,
        locations, schedule, email, phoneNumber, additionalInfo, discountCode
    } = req.body;

    if (!accessKey || !password || !packageName || !totalPrice || !email || !phoneNumber) {
        return res.status(400).json({ message: 'Missing required booking information.' });
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const clientId = await generateUniqueClientId(client);
        const salt = await bcrypt.genSalt(10);
        const passwordHash = await bcrypt.hash(password, salt);

        const query = `
            INSERT INTO bookings (
                client_id, password_hash, access_key, package_name, total_price, selected_items,
                bride_name, groom_name, wedding_date, bride_address, groom_address, locations, schedule, 
                email, phone_number, additional_info, discount_code
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
            RETURNING id, client_id;
        `;
        const values = [
            clientId, passwordHash, accessKey, packageName, totalPrice, JSON.stringify(selectedItems),
            brideName, groomName, weddingDate || null, brideAddress || null, groomAddress || null,
            locations || null, schedule || null, email, phoneNumber, additionalInfo || null, discountCode || null
        ];

        const result = await client.query(query, values);
        await client.query('COMMIT');

        res.status(201).json({ 
            message: 'Booking created successfully.', 
            bookingId: result.rows[0].id,
            clientId: result.rows[0].client_id 
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating booking:', err);
        res.status(500).json({ message: 'Server error while creating booking.' });
    } finally {
        client.release();
    }
});

app.post('/api/login', async (req, res) => {
    const { clientId, password } = req.body;
    if (!clientId || !password) {
        return res.status(400).json({ message: 'Numer klienta i hasło są wymagane.' });
    }

    try {
        const result = await pool.query('SELECT * FROM bookings WHERE client_id = $1', [clientId.trim()]);
        if (result.rowCount === 0) {
            return res.status(401).json({ message: 'Nieprawidłowy numer klienta lub hasło.' });
        }

        const booking = result.rows[0];
        const isMatch = await bcrypt.compare(password, booking.password_hash);

        if (!isMatch) {
            return res.status(401).json({ message: 'Nieprawidłowy numer klienta lub hasło.' });
        }

        const payload = { user: { clientId: booking.client_id } };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '1d' });

        res.json({ token });

    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ message: 'Błąd serwera podczas logowania.' });
    }
});

app.get('/api/my-booking', authenticateToken, async (req, res) => {
    try {
        const { clientId } = req.user.user;
        const result = await pool.query('SELECT * FROM bookings WHERE client_id = $1', [clientId]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nie znaleziono rezerwacji.' });
        }

        const { password_hash, ...bookingData } = result.rows[0];
        res.json(bookingData);

    } catch (err) {
        console.error('Error fetching booking data:', err);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania danych.' });
    }
});

app.patch('/api/my-booking', authenticateToken, async (req, res) => {
    try {
        const { clientId } = req.user.user;
        const { bride_address, groom_address, locations, schedule, additional_info } = req.body;
        
        const result = await pool.query(
            `UPDATE bookings 
             SET bride_address = $1, groom_address = $2, locations = $3, schedule = $4, additional_info = $5
             WHERE client_id = $6
             RETURNING *`,
            [bride_address, groom_address, locations, schedule, additional_info, clientId]
        );
        
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nie znaleziono rezerwacji do zaktualizowania.' });
        }
        
        const { password_hash, ...updatedBooking } = result.rows[0];
        res.json({ message: 'Dane zostały pomyślnie zaktualizowane.', booking: updatedBooking });

    } catch (err) {
        console.error('Error updating booking data:', err);
        res.status(500).json({ message: 'Błąd serwera podczas aktualizacji danych.' });
    }
});

// --- ADMIN Endpoints ---
app.post('/api/admin/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ message: 'Email i hasło są wymagane.' });
    }
    
    try {
        const result = await pool.query('SELECT * FROM admins WHERE email = $1', [email]);
        if (result.rowCount === 0) {
            return res.status(401).json({ message: 'Nieprawidłowy email lub hasło.' });
        }
        
        const admin = result.rows[0];
        const isMatch = await bcrypt.compare(password, admin.password_hash);
        
        if (!isMatch) {
            return res.status(401).json({ message: 'Nieprawidłowy email lub hasło.' });
        }
        
        const payload = { admin: { id: admin.id, email: admin.email } };
        const token = jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: '1d' });
        
        res.json({ token });
        
    } catch(err) {
        console.error('Admin login error:', err);
        res.status(500).json({ message: 'Błąd serwera podczas logowania administratora.' });
    }
});

app.get('/api/admin/bookings', authenticateAdminToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, client_id, bride_name, groom_name, wedding_date, total_price, created_at 
             FROM bookings 
             ORDER BY created_at DESC`
        );
        res.json(result.rows);
    } catch(err) {
        console.error('Error fetching bookings for admin:', err);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania rezerwacji.' });
    }
});

app.get('/api/admin/bookings/:id', authenticateAdminToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT * FROM bookings WHERE id = $1', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nie znaleziono rezerwacji.' });
        }
        const { password_hash, ...bookingData } = result.rows[0];
        res.json(bookingData);
    } catch (err) {
        console.error(`Error fetching booking details for admin (id: ${id}):`, err);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania szczegółów rezerwacji.' });
    }
});

app.patch('/api/admin/bookings/:id', authenticateAdminToken, async (req, res) => {
    const { id } = req.params;
    const {
        bride_name, groom_name, email, phone_number, wedding_date,
        bride_address, groom_address, locations, schedule, additional_info
    } = req.body;

    if (!bride_name || !groom_name || !email || !phone_number || !wedding_date) {
        return res.status(400).json({ message: 'Brak wymaganych pól do aktualizacji.' });
    }

    try {
        const result = await pool.query(
            `UPDATE bookings
             SET bride_name = $1, groom_name = $2, email = $3, phone_number = $4, wedding_date = $5,
                 bride_address = $6, groom_address = $7, locations = $8, schedule = $9, additional_info = $10
             WHERE id = $11
             RETURNING *`,
            [
                bride_name, groom_name, email, phone_number, wedding_date,
                bride_address, groom_address, locations, schedule, additional_info,
                id
            ]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nie znaleziono rezerwacji do zaktualizowania.' });
        }

        const { password_hash, ...updatedBooking } = result.rows[0];
        res.json({ message: 'Rezerwacja została pomyślnie zaktualizowana.', booking: updatedBooking });
    } catch (err) {
        console.error(`Błąd podczas aktualizacji rezerwacji (id: ${id}):`, err);
        res.status(500).json({ message: 'Błąd serwera podczas aktualizacji rezerwacji.' });
    }
});

app.get('/api/admin/access-keys', authenticateAdminToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM access_keys ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching access keys for admin:', err);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania kluczy dostępu.' });
    }
});

app.post('/api/admin/access-keys', authenticateAdminToken, async (req, res) => {
    const { client_name } = req.body;
    if (!client_name) {
        return res.status(400).json({ message: 'Nazwa klienta jest wymagana.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        let newKey;
        let isUnique = false;
        while (!isUnique) {
            newKey = Math.random().toString(36).substring(2, 8).toUpperCase();
            const res = await client.query('SELECT id FROM access_keys WHERE key = $1', [newKey]);
            if (res.rowCount === 0) {
                isUnique = true;
            }
        }
        
        const result = await client.query(
            'INSERT INTO access_keys (key, client_name) VALUES ($1, $2) RETURNING *',
            [newKey, client_name]
        );
        await client.query('COMMIT');
        res.status(201).json(result.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creating access key:', err);
        res.status(500).json({ message: 'Błąd serwera podczas tworzenia klucza dostępu.' });
    } finally {
        client.release();
    }
});

app.delete('/api/admin/access-keys/:id', authenticateAdminToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM access_keys WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nie znaleziono klucza do usunięcia.' });
        }
        res.status(200).json({ message: 'Klucz dostępu został pomyślnie usunięty.' });
    } catch (err) {
        console.error(`Error deleting access key (id: ${id}):`, err);
        res.status(500).json({ message: 'Błąd serwera podczas usuwania klucza dostępu.' });
    }
});

// --- ADMIN AVAILABILITY ENDPOINTS ---

app.get('/api/admin/availability', authenticateAdminToken, async (req, res) => {
    try {
        const availabilityRes = await pool.query('SELECT * FROM availability');
        const bookingsRes = await pool.query('SELECT id, bride_name, groom_name, wedding_date FROM bookings WHERE wedding_date IS NOT NULL');

        const customEvents = availabilityRes.rows.map(e => ({
            id: e.id,
            title: e.title,
            start: new Date(e.start_time),
            end: new Date(e.end_time),
            allDay: e.is_all_day,
            description: e.description,
            resource: { type: 'event' }
        }));
        
        const bookingEvents = bookingsRes.rows.map(b => ({
            id: `booking-${b.id}`,
            title: `Ślub: ${b.bride_name} i ${b.groom_name}`,
            start: b.wedding_date,
            end: b.wedding_date,
            allDay: true,
            resource: { type: 'booking', bookingId: b.id }
        }));
        
        res.json([...customEvents, ...bookingEvents]);
    } catch (err) {
        console.error('Error fetching availability:', err);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania dostępności.' });
    }
});

app.post('/api/admin/availability', authenticateAdminToken, async (req, res) => {
    const { title, start_time, end_time, is_all_day, description } = req.body;
    if (!title || !start_time || !end_time) {
        return res.status(400).json({ message: 'Tytuł, początek i koniec wydarzenia są wymagane.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO availability (title, start_time, end_time, is_all_day, description) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [title, start_time, end_time, !!is_all_day, description || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error creating availability event:', err);
        res.status(500).json({ message: 'Błąd serwera podczas tworzenia wydarzenia.' });
    }
});

app.patch('/api/admin/availability/:id', authenticateAdminToken, async (req, res) => {
    const { id } = req.params;
    const { title, start_time, end_time, is_all_day, description } = req.body;
    if (!title || !start_time || !end_time) {
        return res.status(400).json({ message: 'Tytuł, początek i koniec wydarzenia są wymagane.' });
    }
    try {
        const result = await pool.query(
            'UPDATE availability SET title = $1, start_time = $2, end_time = $3, is_all_day = $4, description = $5 WHERE id = $6 RETURNING *',
            [title, start_time, end_time, !!is_all_day, description || null, id]
        );
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nie znaleziono wydarzenia do zaktualizowania.' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error(`Error updating availability event (id: ${id}):`, err);
        res.status(500).json({ message: 'Błąd serwera podczas aktualizacji wydarzenia.' });
    }
});

app.delete('/api/admin/availability/:id', authenticateAdminToken, async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('DELETE FROM availability WHERE id = $1 RETURNING id', [id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Nie znaleziono wydarzenia do usunięcia.' });
        }
        res.status(200).json({ message: 'Wydarzenie zostało pomyślnie usunięte.' });
    } catch (err) {
        console.error(`Error deleting availability event (id: ${id}):`, err);
        res.status(500).json({ message: 'Błąd serwera podczas usuwania wydarzenia.' });
    }
});


// --- ADMIN GALLERY ENDPOINTS ---
app.post('/api/admin/galleries/upload', authenticateAdminToken, async (req, res) => {
    const { filename } = req.query;
    if (!filename) {
        return res.status(400).json({ message: 'Filename is required.' });
    }
    try {
        const blob = await put(filename, req, {
          access: 'public',
        });
        res.status(200).json(blob);
    } catch(err) {
        console.error('Error uploading file to blob:', err);
        res.status(500).json({ message: `Error uploading file: ${err.message}` });
    }
});

app.get('/api/admin/galleries', authenticateAdminToken, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM galleries ORDER BY created_at DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching admin gallery:', err);
        res.status(500).json({ message: 'Błąd serwera podczas pobierania galerii.' });
    }
});

app.post('/api/admin/galleries', authenticateAdminToken, async (req, res) => {
    const { title, description, image_url } = req.body;
    if (!title || !image_url) {
        return res.status(400).json({ message: 'Title and image URL are required.' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO galleries (title, description, image_url) VALUES ($1, $2, $3) RETURNING *',
            [title, description || null, image_url]
        );
        res.status(201).json(result.rows[0]);
    } catch(err) {
        console.error('Error saving gallery item:', err);
        res.status(500).json({ message: 'Błąd serwera podczas zapisu do galerii.' });
    }
});

app.delete('/api/admin/galleries/:id', authenticateAdminToken, async (req, res) => {
    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const galleryItemRes = await client.query('SELECT image_url FROM galleries WHERE id = $1', [id]);
        if (galleryItemRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ message: 'Nie znaleziono elementu galerii.' });
        }
        
        const imageUrl = galleryItemRes.rows[0].image_url;
        await del(imageUrl);
        
        await client.query('DELETE FROM galleries WHERE id = $1', [id]);
        
        await client.query('COMMIT');
        res.status(200).json({ message: 'Element galerii został usunięty.' });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`Error deleting gallery item (id: ${id}):`, err);
        res.status(500).json({ message: 'Błąd serwera podczas usuwania elementu galerii.' });
    } finally {
        client.release();
    }
});


// --- Start Server ---
const startServer = async () => {
  await initializeDatabase();
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
};

startServer();
