const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const path = require('path');
const { google } = require('googleapis');

const app = express();
// SQLite is no longer the primary database for users/logs, but we can keep it for future use or remove it.
// For now, we will comment out the database initialization that creates a default admin.
/*
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
*/
const JWT_SECRET = process.env.JWT_SECRET || 'your-default-super-secret-key';
app.use(bodyParser.json());
app.use(express.static('public'));

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
    if (!mobile) {
        return res.status(400).json({ error: "Mobile number is required." });
    }

    readFromGoogleSheet('Users!A:F').then(users => {
        // Assuming 'Mobile' is in column C (index 2)
        const userRow = users.find(row => row[2] === mobile);

        if (!userRow) {
            return res.status(404).json({ error: "User not registered" });
        }

        const user = {
            id: userRow[0],         // UserID in column A
            name: userRow[1],       // Name in column B
            mobile: userRow[2],     // Mobile in column C
            role: userRow[3],       // Role in column D
            base_charge: parseFloat(userRow[4]) || 0, // BaseCharge in column E
            rate_per_unit: parseFloat(userRow[5]) || 0, // RatePerUnit in column F
        };

        const accessToken = jwt.sign({ id: user.id, role: user.role, name: user.name }, JWT_SECRET, { expiresIn: '1d' });
        res.json({ success: true, token: accessToken, user });

    }).catch(err => res.status(500).json({ error: "Failed to access user data." }));
});

app.post('/api/register-user', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    const { mobile, name, role, base_charge, rate_per_unit } = req.body;
    const newUserId = `user_${Date.now()}`; // Generate a unique user ID

    const newUserRow = [newUserId, name, mobile, role, base_charge, rate_per_unit];

    try {
        await appendToGoogleSheet('Users!A:F', [newUserRow]);
        res.json({ success: true, userId: newUserId });
    } catch (error) {
        res.status(500).json({ error: "Failed to create user." });
    }
});

// --- SUB-ADMIN: LOG SERVICE COUNT ---
app.post('/api/service/add', authenticateToken, authorizeRoles('subadmin', 'admin'), async (req, res) => {
    const { user_id, service_count, service_date } = req.body;

    try {
        const users = await readFromGoogleSheet('Users!A:F');
        const userRow = users.find(row => row[0] === user_id);

        if (!userRow) {
            return res.status(404).json({ error: "User not found." });
        }

        const userName = userRow[1];
        const baseCharge = parseFloat(userRow[4]) || 0;
        const ratePerUnit = parseFloat(userRow[5]) || 0;

        const calculated_amount = baseCharge + (service_count * ratePerUnit);

        await appendToGoogleSheet('ServiceLogs!A:E', [[service_date, userName, user_id, service_count, calculated_amount]]);
        res.json({ success: true, amount: calculated_amount });

    } catch (error) {
        res.status(500).json({ error: "Failed to log service." });
    }
});

// --- USER DASHBOARD: FETCH SUMMARY & GENERATE PAY QR ---
app.get('/api/user/summary/:userId', authenticateToken, async (req, res) => {
    const userId = req.params.userId;

    try {
        const [serviceLogs, payments] = await Promise.all([
            readFromGoogleSheet('ServiceLogs!A:E'),
            readFromGoogleSheet('Payments!A:F')
        ]);

        const userServices = serviceLogs.filter(row => row[2] === userId);
        const userPayments = payments.filter(row => row[1] === userId && row[4].includes('verified'));

        const total_services = userServices.reduce((sum, row) => sum + (parseInt(row[3], 10) || 0), 0);
        const total_service_cost = userServices.reduce((sum, row) => sum + (parseFloat(row[4]) || 0), 0);
        const total_paid = userPayments.reduce((sum, row) => sum + (parseFloat(row[3]) || 0), 0);
        
        const balance_due = total_service_cost - total_paid;

        res.json({ total_services, total_cost: total_service_cost, total_paid, balance_due: balance_due > 0 ? balance_due : 0 });

    } catch (err) {
        res.status(500).json({ error: "Failed to calculate summary." });
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
    const { amount_submitted } = req.body;
    const user_id = req.user.id;
    const payment_id = `pay_${Date.now()}`;
    const payment_date = new Date().toISOString();
    const newPaymentRow = [payment_id, user_id, amount_submitted, 0, 'pending', payment_date];

    appendToGoogleSheet('Payments!A:F', [newPaymentRow])
        .then(() => res.json({ success: true, requestId: payment_id }))
        .catch(err => res.status(500).json({ error: "Failed to submit payment request." }));
});

// --- ADMIN VERIFICATION & EDITING ---
app.get('/api/admin/pending-payments', authenticateToken, authorizeRoles('admin'), (req, res) => {
    db.all(
        `SELECT p.*, u.name, u.mobile FROM payment_requests p JOIN users u ON p.user_id = u.id WHERE p.status = 'pending'`,
        [],
        (err, rows) => { // This part needs to be migrated to Google Sheets
            readFromGoogleSheet('Payments!A:F').then(payments => {
                const pending = payments.filter(p => p[4] === 'pending');
                res.json(pending);
            }).catch(err => res.status(500).json({ error: "Failed to fetch pending payments." }));
        }
    );
});

app.post('/api/admin/verify-payment', authenticateToken, authorizeRoles('admin'), async (req, res) => {
    const { request_id, verified_amount, action } = req.body; // action: 'approve' or 'edit'

    const status = action === 'edit' ? 'edited_and_verified' : 'verified';

    // Updating a sheet is complex. We need to find the row, then update it.
    // This is a simplified example. A robust implementation would be more complex.
    res.status(501).json({ error: "Payment verification via Google Sheets is not fully implemented." });
});

// --- GOOGLE SHEETS HELPER FUNCTIONS ---
const SPREADSHEET_ID = '1_RufWFvAcnwE7Md3_EJPR4w0EK7NlfNJSypE6boz3qs';

async function getGoogleAuth() {
    return new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, 'credentials.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
}

async function readFromGoogleSheet(range) {
    try {
        const auth = await getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range,
        });
        return response.data.values || [];
    } catch (err) {
        console.error(`Error reading from Google Sheet range ${range}:`, err);
        throw new Error('Failed to read from Google Sheet.');
    }
}

async function appendToGoogleSheet(range, values) {
    try {
        const auth = await getGoogleAuth();
        const sheets = google.sheets({ version: 'v4', auth });
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values,
            },
        });
    } catch (err) {
        console.error(`Error appending to Google Sheet range ${range}:`, err);
        throw new Error('Failed to save to Google Sheet.');
    }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));