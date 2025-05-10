const express = require('express');
const cors = require('cors');  // ✅ ADD CORS
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());  // ✅ ENABLE CORS
app.use(express.json()); // ✅ Parse JSON

const providerUrl = `${process.env.RPC_URL}/${process.env.THIRDWEB_API_KEY}`;
const privateKey = process.env.PRIVATE_KEY;
const relayHubAddress = process.env.RELAY_HUB_ADDRESS;
const paymasterAddress = process.env.PAYMASTER_ADDRESS;

if (!providerUrl || !privateKey || !relayHubAddress || !paymasterAddress) {
  console.error('❌ Missing required .env variables');
  process.exit(1);
}

const provider = new ethers.JsonRpcProvider(providerUrl);
const wallet = new ethers.Wallet(privateKey, provider);

const relayHubAbi = [
  'function relayCall(address paymaster, address target, bytes data, uint256 gasLimit) external',
];
const relayHub = new ethers.Contract(relayHubAddress, relayHubAbi, wallet);

// ✅ Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).send('✅ MODL Relayer is healthy');
});

// ✅ Relay endpoint with validation & debug logs
app.post('/relay', async (req, res) => {
  const { paymaster, target, data, gasLimit, user } = req.body;

  // Validate required fields and ensure proper format
  if (
    !paymaster ||
    !target ||
    !user ||
    typeof data !== 'string' ||
    !data.startsWith('0x') ||
    typeof gasLimit !== 'number'
  ) {
    console.error('❌ Invalid relay request body:', req.body);
    return res.status(400).json({ error: '❌ Missing or invalid required fields' });
  }

  console.log('📥 Incoming relay request:', {
    paymaster,
    target,
    user,
    gasLimit,
    data: data.slice(0, 10) + '...', // log start of data only
  });

  try {
    const tx = await relayHub.relayCall(paymaster, target, data, gasLimit, {
      gasLimit: gasLimit + 100000, // overhead buffer
    });

    console.log(`🚀 Relayed tx submitted: ${tx.hash}`);
    await tx.wait();
    return res.json({ txHash: tx.hash });
  } catch (error: any) {
    console.error('❌ Relay error:', {
      message: error.message,
      reason: error.reason,
      data: error.data,
    });

    return res.status(500).json({
      error: error.message || 'Relay failed',
    });
  }
});


// ✅ Start server
app.listen(port, () => {
  console.log(`✅ MODL Relayer running on port ${port}`);
});

// ✅ Periodic heartbeat
setInterval(() => {
  console.log('⏰ MODL Relayer heartbeat - still alive');
}, 60 * 1000);
