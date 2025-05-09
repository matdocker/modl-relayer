const express = require('express');
const { Wallet, JsonRpcProvider } = require('ethers');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000; // Railway will inject PORT

// Setup provider + wallet
const providerUrl = process.env.RPC_URL;
const privateKey = process.env.PRIVATE_KEY;

if (!privateKey || privateKey.length < 64) {
    console.error('❌ Invalid or missing PRIVATE_KEY in .env');
    process.exit(1);
}

if (!providerUrl) {
    console.error('❌ Missing RPC_URL in .env');
    process.exit(1);
}

const provider = new JsonRpcProvider(providerUrl);
const wallet = new Wallet(privateKey, provider);

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).send('✅ MODL Relayer is healthy');
});

// Example root log
app.get('/', (req, res) => {
    res.send('✅ MODL Relayer is running');
});

// Start server
app.listen(port, () => {
    console.log(`✅ MODL Relayer running on port ${port}`);
});

// Example periodic log to show it’s alive
setInterval(() => {
    console.log('⏰ MODL Relayer heartbeat - still alive');
}, 60 * 1000); // every 60 seconds
