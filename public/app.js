const API_URL = '/api'; // Use relative path for production

// --- STATE MANAGEMENT ---
const state = {
    user: null,
    token: null,
    paymentAmount: 0,
};

// --- DOM ELEMENTS ---
const loginBox = document.getElementById('login-box');
const dashboard = document.getElementById('dashboard');
const logoutBtn = document.getElementById('logout-btn');
const welcomeMsg = document.getElementById('welcome-msg');
const userView = document.getElementById('user-view');
const subadminView = document.getElementById('subadmin-view');
const adminView = document.getElementById('admin-view');

// --- API HELPERS ---
async function apiRequest(endpoint, method = 'GET', body = null) {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }

    const config = {
        method,
        headers,
    };

    if (body) {
        config.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_URL}${endpoint}`, config);
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || `HTTP error! status: ${response.status}`);
        }
        // Handle cases where there is no JSON body to parse
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.indexOf("application/json") !== -1) {
            return await response.json();
        }
        return;
    } catch (error) {
        alert(`API Error: ${error.message}`);
        console.error('API Request Failed:', error);
        return null;
    }
}

// --- AUTHENTICATION ---
async function onSignIn(googleUser) {
    const id_token = googleUser.getAuthResponse().id_token;
    
    // We need a backend endpoint to verify this token and log the user in.
    // For this example, we'll simulate a login by using the profile info directly.
    // In a real app, you would POST the id_token to your server, verify it,
    // and get back your application's own JWT.
    const profile = googleUser.getBasicProfile();
    const mockUserData = {
        id: profile.getId(),
        name: profile.getName(),
        email: profile.getEmail(),
        role: 'admin' // Assuming anyone signing in with Google is an admin for this example
    };

    // For demonstration, we'll just use a mock login process.
    // Replace this with a call to your backend for real authentication.
    const data = { success: true, user: mockUserData, token: id_token };

    if (data && data.success) {
        state.user = data.user;
        state.token = data.token;
        localStorage.setItem('jwt_token', data.token);
        localStorage.setItem('user_info', JSON.stringify(data.user));
        showDashboard();
    }
}

function logout() {
    var auth2 = gapi.auth2.getAuthInstance();
    auth2.signOut().then(function () {
        console.log('User signed out.');
        state.user = null;
        state.token = null;
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_info');
        showLogin();
    });
}

// --- UI RENDERING ---
function showDashboard() {
    loginBox.style.display = 'none';
    dashboard.style.display = 'block';
    // The logout button is not in the provided HTML, but this would control it.
    // logoutBtn.style.display = 'block'; 
    welcomeMsg.textContent = `Welcome, ${state.user.name}! (${state.user.role})`;

    userView.style.display = 'none';
    subadminView.style.display = 'none';
    adminView.style.display = 'none';

    if (state.user.role === 'user') {
        userView.style.display = 'block';
        fetchUserSummary();
    } else if (state.user.role === 'subadmin') {
        subadminView.style.display = 'block';
    } else if (state.user.role === 'admin') {
        adminView.style.display = 'block';
        fetchSheetData(); // Fetch sheet data on login for admin
    }
}

function showLogin() {
    loginBox.style.display = 'block';
    dashboard.style.display = 'none';
    logoutBtn.style.display = 'none';
}

// --- USER ROLE FUNCTIONS ---
async function fetchUserSummary() {
    // The endpoint in server.js is /api/user/summary/:userId, but it should use the authenticated user
    // Let's assume a corrected endpoint /api/user/summary that uses the token
    const data = await apiRequest(`/user/summary/${state.user.id}`);
    if (data) {
        const summaryCards = document.getElementById('summary-cards');
        summaryCards.innerHTML = `
            <div class="card"><h5>Total Services</h5><p>${data.total_services}</p></div>
            <div class="card"><h5>Total Cost</h5><p>₹${data.total_cost.toFixed(2)}</p></div>
            <div class="card"><h5>Total Paid</h5><p>₹${data.total_paid.toFixed(2)}</p></div>
            <div class="card"><h5>Balance Due</h5><p>₹${data.balance_due.toFixed(2)}</p></div>
        `;
        document.getElementById('pay-amount').value = data.balance_due.toFixed(2);
    }
}

async function generateQR() {
    const amount = document.getElementById('pay-amount').value;
    if (!amount || amount <= 0) return alert('Please enter a valid amount.');

    state.paymentAmount = parseFloat(amount);
    const data = await apiRequest('/user/generate-qr', 'POST', { amount: state.paymentAmount, upi_id: 'your-upi-id@okbank', name: 'Your Name' });

    if (data && data.success) {
        const qrContainer = document.getElementById('qr-container');
        qrContainer.innerHTML = `<img src="${data.qrCode}" alt="UPI QR Code">`;
        document.getElementById('confirm-pay-btn').style.display = 'block';
    }
}

async function submitPayment() {
    if (state.paymentAmount <= 0) return alert('No payment amount specified.');
    
    const data = await apiRequest('/user/pay', 'POST', { user_id: state.user.id, amount_submitted: state.paymentAmount });
    if (data && data.success) {
        alert('Payment claim submitted for verification!');
        document.getElementById('qr-container').innerHTML = '';
        document.getElementById('confirm-pay-btn').style.display = 'none';
        fetchUserSummary();
    }
}

// --- SUB-ADMIN ROLE FUNCTIONS ---
async function logService() {
    const userId = document.getElementById('target-user-id').value;
    const serviceCount = document.getElementById('service-count').value;
    const serviceDate = document.getElementById('service-date').value;

    if (!userId || !serviceCount || !serviceDate) return alert('Please fill all fields.');

    const data = await apiRequest('/service/add', 'POST', {
        user_id: parseInt(userId),
        subadmin_id: state.user.id,
        service_count: parseInt(serviceCount),
        service_date: serviceDate
    });

    if (data && data.success) {
        alert(`Service logged successfully! Calculated amount: ₹${data.amount.toFixed(2)}`);
        document.getElementById('target-user-id').value = '';
        document.getElementById('service-count').value = '';
        document.getElementById('service-date').value = '';
    }
}

// --- ADMIN ROLE FUNCTIONS ---
async function fetchPendingPayments() {
    // Implementation for fetching and displaying pending payments
}

async function fetchSheetData() {
    const result = await apiRequest('/sheet-data');
    const container = document.getElementById('sheet-data-container');

    if (result && result.success) {
        const data = result.data;
        if (data.length === 0) {
            container.innerHTML = '<p>No data found in the Google Sheet.</p>';
            return;
        }

        // Render data as a table
        let table = '<table class="sheet-table"><thead><tr>';
        const headers = data[0];
        headers.forEach(header => table += `<th>${header}</th>`);
        table += '</tr></thead><tbody>';

        for (let i = 1; i < data.length; i++) {
            table += '<tr>';
            data[i].forEach(cell => table += `<td>${cell}</td>`);
            table += '</tr>';
        }
        table += '</tbody></table>';
        container.innerHTML = table;
    } else {
        container.innerHTML = '<p>Error fetching data.</p>';
    }
}

function togglePricingFields() {
    const role = document.getElementById('new-user-role').value;
    const pricingFields = document.getElementById('pricing-fields');
    pricingFields.style.display = role === 'user' ? 'block' : 'none';
}

async function createUser() {
    const name = document.getElementById('new-user-name').value;
    const mobile = document.getElementById('new-user-mobile').value;
    const role = document.getElementById('new-user-role').value;
    const payload = { name, mobile, role };

    if (role === 'user') {
        payload.service_range = document.getElementById('new-user-service-range').value;
        payload.rate_per_unit = parseFloat(document.getElementById('new-user-rate').value);
        payload.base_charge = parseFloat(document.getElementById('new-user-base-charge').value);
    }

    const data = await apiRequest('/register-user', 'POST', payload);
    if (data && data.success) {
        alert('User created successfully!');
    }
}

// --- INITIALIZATION ---
function startApp() {
    gapi.load('auth2', function() {
        // Initialize the GoogleAuth object.
        gapi.auth2.init({
            client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
        }).then(() => {
            // Check if the user is already signed in
            if (gapi.auth2.getAuthInstance().isSignedIn.get()) {
                onSignIn(gapi.auth2.getAuthInstance().currentUser.get());
            } else {
                // Render the sign-in button
                gapi.signin2.render('g-signin2', {
                    'scope': 'profile email',
                    'width': 240,
                    'height': 50,
                    'longtitle': true,
                    'theme': 'dark',
                    'onsuccess': onSignIn,
                });
                showLogin();
            }
        });
    });
}

// The Google script will call this function once it's loaded.
function start() {
  startApp();
}

// Since the google script is async, we need to make sure our app starts after it loads.
// A simple way is to attach our start function to the window object.
window.startApp = startApp;
// Then call it from the HTML body onload or similar. For this setup, we can just call it.
startApp();