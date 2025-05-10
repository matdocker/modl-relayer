const express = require('express');
const cors = require('cors');
const { Wallet, JsonRpcProvider } = require('ethers');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000; // Railway injects PORT

// Middleware
app.use(cors()); // ✅ Allow all origins (or configure below)
app.use(express.json());

// Setup provider + wallet
const providerUrl = process.env.RPC_URL;
const privateKey = process.env.PRIVATE_KEY;
const thirdWebKey = process.env.THIRDWEB_API_KEY;

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
    res.json({ status: 'ok', message: '✅ MODL Relayer is healthy' });
});

// Example root log
app.get('/', (req, res) => {
    res.send('✅ MODL Relayer is running');
});

// Example relay endpoint (expand later!)
app.post('/relay', async (req, res) => {
    const { target, data } = req.body;

    if (!target || !data) {
        return res.status(400).json({ error: 'Missing target or data' });
    }

    try {
        const tx = await wallet.sendTransaction({
            to: target,
            data,
        });

        await tx.wait();

        res.json({
            status: 'success',
            txHash: tx.hash,
        });
    } catch (error) {
        console.error('❌ Relay error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Start server
app.listen(port, () => {
    console.log(`✅ MODL Relayer running on port ${port}`);
});

// Heartbeat log every 60 sec
setInterval(() => {
    console.log('⏰ MODL Relayer heartbeat - still alive');
}, 60 * 1000);
