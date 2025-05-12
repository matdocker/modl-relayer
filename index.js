const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

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
  'function relayCall(address paymaster, address target, bytes data, uint256 gasLimit) external'
];

const relayHub = new ethers.Contract(relayHubAddress, relayHubAbi, wallet);

// ✅ Health check
app.get('/health', (_, res) => {
  res.status(200).send('✅ MODL Relayer is healthy');
});

// ✅ Relay endpoint
app.post('/relay', async (req, res) => {
  const {
    paymaster,
    target,
    encodedData,
    gasLimit,
    user,
  } = req.body;

  if (
    !paymaster ||
    !target ||
    !user ||
    typeof encodedData !== 'string' ||
    !encodedData.startsWith('0x') ||
    typeof gasLimit !== 'number'
  ) {
    console.error('❌ Invalid relay request:', req.body);
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  console.log('📨 Relayer Request Payload:', {
    paymaster,
    target,
    gasLimit,
    user,
    preview: encodedData.slice(0, 10) + '...',
  });

  try {
    const gasEstimate = gasLimit + 100_000;
    const { gasPrice } = await provider.getFeeData(); // ✅ Ethers v6 compatible
    if (!gasPrice) throw new Error("Gas price unavailable from provider");

    const tx = await relayHub.relayCall(paymaster, target, encodedData, gasLimit, {
      gasLimit: gasEstimate,
      gasPrice: gasPrice,
    });

    console.log(`🚀 relayCall() tx sent: ${tx.hash}`);
    await tx.wait();
    return res.json({ txHash: tx.hash });
  } catch (err) {
    console.error('❌ relayCall() failed:', {
      message: err.message,
      reason: err.reason,
      code: err.code,
      data: err.data,
    });

    return res.status(500).json({
      error: err.message || 'Relay failed',
    });
  }
});

// ✅ Heartbeat
app.listen(port, () => {
  console.log(`✅ MODL Relayer running on port ${port}`);
});

setInterval(() => {
  console.log('⏰ Heartbeat: MODL relayer still alive');
}, 60_000);
