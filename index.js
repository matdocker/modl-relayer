const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 8080;

// ✅ CORS: Allow specific origins and handle preflight OPTIONS
const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map(origin => origin.trim()) || [];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.warn(`⚠️ Blocked by CORS: ${origin}`);
      callback(new Error(`❌ CORS not allowed for origin: ${origin}`));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
  optionsSuccessStatus: 204, // ✅ Important for legacy browsers
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // ✅ Catch-all preflight handler

app.use(express.json());

// ✅ Load environment
const providerUrl = `${process.env.RPC_URL}/${process.env.THIRDWEB_API_KEY}`;
const privateKey = process.env.PRIVATE_KEY;
const relayHubAddress = process.env.RELAY_HUB_ADDRESS;
const paymasterAddress = process.env.PAYMASTER_ADDRESS;

if (!providerUrl || !privateKey || !relayHubAddress || !paymasterAddress) {
  console.error('❌ Missing .env configuration');
  process.exit(1);
}

// ✅ Load ABI from file
let relayHubAbi;
try {
  const abiPath = path.join(__dirname, './abi/MODLRelayHub.json');
  const raw = fs.readFileSync(abiPath, 'utf8');
  relayHubAbi = JSON.parse(raw).abi;
  console.log('✅ ABI loaded from ./abi/MODLRelayHub.json');
} catch (err) {
  console.error('❌ Failed to load ABI:', err);
  process.exit(1);
}

// ✅ Setup signer + contract
const provider = new ethers.JsonRpcProvider(providerUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const relayHub = new ethers.Contract(relayHubAddress, relayHubAbi, wallet);

// ✅ Health check
app.get('/health', (_, res) => {
  res.status(200).send('✅ MODL Relayer is healthy');
});

// ✅ Relay request endpoint
app.post('/relay', async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;

  console.log('\n📥 Relay request received');
  console.log({
    paymaster,
    target,
    user,
    gasLimit,
    encodedData: encodedData?.slice(0, 20) + '...',
  });

  if (
    !paymaster || !target || !user ||
    typeof encodedData !== 'string' || !encodedData.startsWith('0x') ||
    typeof gasLimit !== 'number'
  ) {
    console.error('❌ Invalid relay payload');
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  try {
    const totalGasLimit = gasLimit + 100_000;
    const { gasPrice } = await provider.getFeeData();
    if (!gasPrice) throw new Error('Gas price unavailable');

    console.log(`🔧 Calling relayCall → ${relayHubAddress}`);
    const tx = await relayHub.relayCall(paymaster, target, encodedData, gasLimit, {
      gasLimit: totalGasLimit,
      gasPrice,
    });

    console.log(`🚀 relayCall tx sent: ${tx.hash}`);
    await tx.wait();
    console.log('✅ relayCall confirmed');
    res.json({ txHash: tx.hash });
  } catch (err) {
    console.error('❌ relayCall failed:', {
      message: err.message,
      reason: err.reason,
      code: err.code,
      data: err.data,
    });
    res.status(500).json({ error: err.message || 'Relay failed' });
  }
});

// ✅ Server startup
app.listen(port, () => {
  console.log(`✅ MODL Relayer live at http://localhost:${port}`);
});

// ✅ Keep-alive logging
setInterval(() => {
  console.log('⏰ Heartbeat: MODL relayer still alive');
}, 60_000);
