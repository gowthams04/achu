const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const path = require('path');
const { google } = require('googleapis');

// Define the path for the database. Use the environment variable on Render, or a local file.
const dbPath = process.env.RENDER_DISK_MOUNT_PATH ? path.join(process.env.RENDER_DISK_MOUNT_PATH, 'database.db') : './database.db';

const app = express();
const db = new sqlite3.Database(dbPath);

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key';
app.use(bodyParser.json());
app.use(express.static('public'));

// Initialize Database Tables
const fs = require('fs');
db.serialize(() => {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    db.exec(schema);

    // On startup, check if an 'admin' user exists. If not, create one.
    const adminMobile = '0000000000'; // IMPORTANT: Change this to a secure, real mobile number
    db.get('SELECT * FROM users WHERE role = ?', ['admin'], (err, adminUser) => {
        if (!adminUser) {
            db.run('INSERT INTO users (mobile, name, role) VALUES (?, ?, ?)', [adminMobile, 'admin', 'admin'], (err) => {
                if (!err) {
                    console.log(`Default admin user created. Login with mobile: ${adminMobile}`);
                }
            });
        }
    });
});
// --- MIDDLEWARE ---
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

const authorizeRoles = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
        }
        next();
    };
};

// --- AUTHENTICATION ---
app.post('/api/login', (req, res) => {
    const { mobile } = req.body;
    db.get(`SELECT * FROM users WHERE mobile = ?`, [mobile], (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(404).json({ error: "User not registered" });

        // On successful login, generate a JWT
        const accessToken = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '1d' });

        res.json({ 
            success: true, 
            token: accessToken,
            user: { id: user.id, name: user.name, role: user.role, mobile: user.mobile } 
        });
    });
});

app.post('/api/register-user', authenticateToken, authorizeRoles('admin'), (req, res) => {
    const { mobile, name, role, service_range, rate_per_unit, base_charge } = req.body;
    
    db.run(`INSERT INTO users (mobile, name, role) VALUES (?, ?, ?)`, [mobile, name, role || 'user'], function(err) {
        if (err) return res.status(400).json({ error: "Mobile number already exists" });
        const userId = this.lastID;

        if (role === 'user' && service_range) {
            db.run(
                `INSERT INTO pricing_rules (user_id, service_range, rate_per_unit, base_charge) VALUES (?, ?, ?, ?)`,
                [userId, service_range, rate_per_unit, base_charge]
            );
        }
        res.json({ success: true, userId });
    });
});

// --- SUB-ADMIN: LOG SERVICE COUNT ---
app.post('/api/service/add', authenticateToken, authorizeRoles('subadmin', 'admin'), (req, res) => {
    const { user_id, service_count, service_date } = req.body;

    // Fetch user and pricing details in parallel
    const userQuery = new Promise((resolve, reject) => {
        db.get(`SELECT name FROM users WHERE id = ?`, [user_id], (err, user) => {
            if (err || !user) return reject(new Error("User not found."));
            resolve(user);
        });
    });

    const pricingQuery = new Promise((resolve, reject) => {
        db.get(`SELECT * FROM pricing_rules WHERE user_id = ?`, [user_id], (err, rule) => {
            if (err || !rule) return reject(new Error("Pricing rule not set for this user."));
            resolve(rule);
        });
    });

    Promise.all([userQuery, pricingQuery]).then(async ([user, rule]) => {
        if (err || !rule) return res.status(400).json({ error: "Pricing rule not set for this user." });

        // Pricing logic: Base charge + (Count * Rate per unit)
        const calculated_amount = rule.base_charge + (service_count * rule.rate_per_unit);

        // Append data to Google Sheet
        await appendToGooglSheet([service_date, user.name, user_id, service_count, calculated_amount]);

        res.json({ success: true, amount: calculated_amount });
    }).catch(error => res.status(400).json({ error: error.message }));
});

// --- USER DASHBOARD: FETCH SUMMARY & GENERATE PAY QR ---
app.get('/api/user/summary/:userId', authenticateToken, async (req, res) => {
    const userId = req.params.userId;

    const query = `
        SELECT 
            (SELECT COALESCE(SUM(calculated_amount), 0) FROM service_logs WHERE user_id = ?) as total_service_cost,
            (SELECT COALESCE(SUM(service_count), 0) FROM service_logs WHERE user_id = ?) as total_services,
            (SELECT COALESCE(SUM(amount_verified), 0) FROM payment_requests WHERE user_id = ? AND status LIKE '%verified%') as total_paid
    `;

    try {
        // Fetch service data from Google Sheet
        const sheetData = await readFromGoogleSheet();
        const userServices = sheetData.filter(row => row[2] === userId); // Filter by UserID in column C

        let total_services = 0;
        let total_service_cost = 0;

        userServices.forEach(row => {
            total_services += parseInt(row[3], 10) || 0; // ServiceCount in column D
            total_service_cost += parseFloat(row[4]) || 0; // CalculatedAmount in column E
        });

        // Fetch payment data from SQLite
        const paymentsRow = await new Promise((resolve, reject) => db.get(`SELECT COALESCE(SUM(amount_verified), 0) as total_paid FROM payment_requests WHERE user_id = ? AND status LIKE '%verified%'`, [userId], (err, row) => err ? reject(err) : resolve(row)));
        const total_paid = paymentsRow.total_paid;
        
        const balance_due = total_service_cost - total_paid;

        res.json({ total_services, total_cost: total_service_cost, total_paid, balance_due: balance_due > 0 ? balance_due : 0 });

    } catch (err) {
        if (err) return res.status(500).json({ error: err.message });
    }
});

// Dynamic UPI QR Code Generator
app.post('/api/user/generate-qr', authenticateToken, authorizeRoles('user'), async (req, res) => {
    const { amount, upi_id, name } = req.body; // e.g., upi_id = "yourname@upi"
    const upiString = `upi://pay?pa=${upi_id}&pn=${encodeURIComponent(name)}&am=${amount}&cu=INR`;
    
    try {
        const qrCodeDataUrl = await QRCode.toDataURL(upiString);
        res.json({ success: true, qrCode: qrCodeDataUrl, amount });
    } catch (err) {
        res.status(500).json({ error: "Failed to generate QR Code" });
    }
});

// User submits payment claim
app.post('/api/user/pay', authenticateToken, authorizeRoles('user'), (req, res) => {
    const { user_id, amount_submitted } = req.body;
    db.run(
        `INSERT INTO payment_requests (user_id, amount_submitted) VALUES (?, ?)`,
        [user_id, amount_submitted],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, requestId: this.lastID });
        }
    );
});

// --- ADMIN VERIFICATION & EDITING ---
app.get('/api/admin/pending-payments', authenticateToken, authorizeRoles('admin'), (req, res) => {
    db.all(
        `SELECT p.*, u.name, u.mobile FROM payment_requests p JOIN users u ON p.user_id = u.id WHERE p.status = 'pending'`,
        [],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

app.post('/api/admin/verify-payment', authenticateToken, authorizeRoles('admin'), (req, res) => {
    const { request_id, verified_amount, action } = req.body; // action: 'approve' or 'edit'

    const status = action === 'edit' ? 'edited_and_verified' : 'verified';

    db.run(
        `UPDATE payment_requests SET amount_verified = ?, status = ?, verified_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [verified_amount, status, request_id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: "Payment verified and balance updated." });
        }
    );
});

// --- GOOGLE SHEETS INTEGRATION ---
app.get('/api/sheet-data', authenticateToken, async (req, res) => {
    try {
        const auth = new google.auth.GoogleAuth({
            // IMPORTANT: Create a 'credentials.json' file from your Google Cloud Service Account
            keyFile: path.join(__dirname, 'credentials.json'),
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // IMPORTANT: Replace with your Google Sheet ID and the desired range
        const spreadsheetId = 'YOUR_SPREADSHEET_ID';
        const range = 'Sheet1!A:D'; // Example: Read columns A to D from Sheet1

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range,
        });

        const rows = response.data.values;
        if (rows.length) {
            res.json({ success: true, data: rows });
        } else {
            res.json({ success: true, data: [], message: 'No data found.' });
        }
    } catch (err) {
        console.error('The API returned an error: ' + err);
        res.status(500).json({ error: 'Failed to fetch data from Google Sheet.' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));