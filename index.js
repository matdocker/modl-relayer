const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// ✅ CORS: Allow specific domains (adjust for production)
app.use(cors({
  origin: ['http://localhost:3000', 'https://your-frontend-domain.com'], // 👈 whitelist your frontend
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
}));

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

// ✅ Load ABI
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

// ✅ Initialize provider/signer/contract
const provider = new ethers.JsonRpcProvider(providerUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const relayHub = new ethers.Contract(relayHubAddress, relayHubAbi, wallet);

// ✅ Health check
app.get('/health', (_, res) => {
  res.status(200).send('✅ MODL Relayer is healthy');
});

// ✅ Relay request
app.post('/relay', async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;

  console.log('\n📥 Relay request received');
  console.log({ paymaster, target, user, gasLimit, encodedData: encodedData?.slice(0, 20) });

  // Validate request
  if (
    !paymaster || !target || !user ||
    typeof encodedData !== 'string' || !encodedData.startsWith('0x') ||
    typeof gasLimit !== 'number'
  ) {
    console.error('❌ Invalid request:', req.body);
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  try {
    const buffer = 100_000;
    const totalGasLimit = gasLimit + buffer;
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

// ✅ Start server
app.listen(port, () => {
  console.log(`✅ MODL Relayer live at http://localhost:${port}`);
});

setInterval(() => {
  console.log('⏰ Heartbeat: MODL relayer still alive');
}, 60_000);
