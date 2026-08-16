# Service Tracker with Google Sheets Backend

A full-stack web application for tracking services and managing payments, using Google Sheets as a live database for service logs.

## Features

- **Hybrid Database Model:**
  - **Google Sheets:** Used as a live, easily editable database for all service logs.
  - **SQLite:** Used for managing user accounts, roles, pricing, and payment requests.
- **Google Sign-In:** Secure authentication using Google accounts.
- **Role-Based Access:** Admin, Sub-Admin, and User roles with different permissions.
- **Dynamic Pricing:** Admins can set custom pricing rules for each user.
- **Dynamic UPI QR Payments:** Generate a unique UPI QR code for the exact amount due.
- **Payment Verification:** Admins can verify, edit, or reject payment claims.

## Setup and Installation

1.  **Install dependencies:**
    ```bash
    npm install
    ```

2.  **Run the server:**
    ```bash
    npm start
    ```

The application will be running at `http://localhost:3000`.
