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
async function login() {
    const mobile = document.getElementById('mobile').value;
    if (!mobile) return alert('Please enter a mobile number.');

    const data = await apiRequest('/login', 'POST', { mobile });

    if (data && data.success) {
        state.user = data.user;
        state.token = data.token;
        localStorage.setItem('jwt_token', data.token);
        localStorage.setItem('user_info', JSON.stringify(data.user));
        showDashboard();
    } else {
        alert('Login failed. User not found or server error.');
    }
}

function logout() {
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
    logoutBtn.style.display = 'block';
    welcomeMsg.textContent = `Welcome, ${state.user.name}! (${state.user.role || 'user'})`;

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
        fetchPendingPayments();
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
    
    const data = await apiRequest('/user/pay', 'POST', { amount_submitted: state.paymentAmount });
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
    // This function will need to be updated to render the data from the sheet
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
window.onload = () => {
    const token = localStorage.getItem('jwt_token');
    const userInfo = localStorage.getItem('user_info');
    if (token && userInfo) {
        state.token = token;
        state.user = JSON.parse(userInfo);
        showDashboard();
    } else {
        showLogin();
    }
};