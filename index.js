const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ✅ Load env variables
const providerUrl = `${process.env.RPC_URL}/${process.env.THIRDWEB_API_KEY}`;
const privateKey = process.env.PRIVATE_KEY;
const relayHubAddress = process.env.RELAY_HUB_ADDRESS;
const paymasterAddress = process.env.PAYMASTER_ADDRESS;

// ✅ Validate env setup
if (!providerUrl || !privateKey || !relayHubAddress || !paymasterAddress) {
  console.error('❌ Missing .env configuration');
  process.exit(1);
}

// ✅ Load ABI from ./abi/MODLRelayHub.json
let relayHubAbi;
try {
  const abiPath = path.join(__dirname, './abi/MODLRelayHub.json');
  const raw = fs.readFileSync(abiPath, 'utf8');
  const parsed = JSON.parse(raw);
  relayHubAbi = parsed.abi;
  console.log('✅ ABI loaded from ./abi/MODLRelayHub.json');
} catch (err) {
  console.error('❌ Failed to load ABI:', err);
  process.exit(1);
}

// ✅ Initialize provider and signer
const provider = new ethers.JsonRpcProvider(providerUrl);
const wallet = new ethers.Wallet(privateKey, provider);
const relayHub = new ethers.Contract(relayHubAddress, relayHubAbi, wallet);

// ✅ Health check
app.get('/health', (_, res) => {
  res.status(200).send('✅ MODL Relayer is healthy');
});

// ✅ Relay route
app.post('/relay', async (req, res) => {
  const {
    paymaster,
    target,
    encodedData,
    gasLimit,
    user,
  } = req.body;

  console.log('\n📥 Incoming relay request:');
  console.log({ paymaster, target, user, gasLimit, preview: encodedData?.slice(0, 20) });

  // ✅ Input validation
  if (
    !paymaster || !target || !user ||
    typeof encodedData !== 'string' || !encodedData.startsWith('0x') ||
    typeof gasLimit !== 'number'
  ) {
    console.error('❌ Invalid relay payload:', req.body);
    return res.status(400).json({ error: 'Missing or invalid fields' });
  }

  try {
    const buffer = 100_000;
    const totalGasLimit = gasLimit + buffer;
    const { gasPrice } = await provider.getFeeData();
    if (!gasPrice) throw new Error('Gas price unavailable');

    console.log(`🔧 Executing relayCall → ${relayHubAddress}`);
    const tx = await relayHub.relayCall(paymaster, target, encodedData, gasLimit, {
      gasLimit: totalGasLimit,
      gasPrice,
    });

    console.log(`🚀 relayCall tx sent: ${tx.hash}`);
    await tx.wait();

    return res.json({ txHash: tx.hash });
  } catch (err) {
    console.error('❌ relayCall failed:', {
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

// ✅ Server start
app.listen(port, () => {
  console.log(`✅ MODL Relayer is live at http://localhost:${port}`);
});

setInterval(() => {
  console.log('⏰ MODL Relayer heartbeat – alive');
}, 60_000);
