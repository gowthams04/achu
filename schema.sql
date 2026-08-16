CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mobile TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT CHECK(role IN ('admin', 'subadmin', 'user')) DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pricing_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    service_range TEXT NOT NULL, -- e.g. "100-300"
    rate_per_unit REAL NOT NULL, -- e.g. 20 (meaning 20 Rs per tier unit)
    base_charge REAL NOT NULL,   -- e.g. 160
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS payment_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount_submitted REAL NOT NULL,
    amount_verified REAL DEFAULT 0,
    status TEXT CHECK(status IN ('pending', 'verified', 'edited_and_verified', 'rejected')) DEFAULT 'pending',
    payment_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_payment_requests_user_id ON payment_requests(user_id);