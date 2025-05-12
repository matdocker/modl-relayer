/* index.js */
const express = require('express');
const cors     = require('cors');
const { ethers } = require('ethers');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

const app  = express();
const port = parseInt(process.env.PORT, 10) || 8080;        // <- 8080 default

/* ---------- CORS ---------- */
const allowedOrigins =
  (process.env.CORS_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    console.warn(`⚠️  CORS blocked: ${origin}`);
    return cb(new Error('Not allowed by CORS'));
  },
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true,
}));
app.options('*', cors());           // pre-flight

app.use(express.json());

/* ---------- ENV + CONTRACT ---------- */
const providerUrl     = `${process.env.RPC_URL}/${process.env.THIRDWEB_API_KEY}`;
const { PRIVATE_KEY, RELAY_HUB_ADDRESS: relayHubAddress } = process.env;
if (!providerUrl || !PRIVATE_KEY || !relayHubAddress) {
  console.error('❌ Missing env vars');  process.exit(1);
}

const abiPath = path.join(__dirname, 'abi', 'MODLRelayHub.json');
const relayHubAbi = JSON.parse(fs.readFileSync(abiPath)).abi;

const provider = new ethers.JsonRpcProvider(providerUrl);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
const relayHub = new ethers.Contract(relayHubAddress, relayHubAbi, wallet);

/* ---------- Routes ---------- */
app.get('/health', (_, res) => res.send('✅ healthy'));

app.post('/relay', async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;
  console.log('📨 relay request', { paymaster, target, gasLimit, user });

  if (!paymaster || !target || !user || typeof encodedData !== 'string' ||
      !encodedData.startsWith('0x') || typeof gasLimit !== 'number') {
    return res.status(400).json({ error: 'invalid payload' });
  }

  try {
    const buffer = 100_000;
    const gas    = gasLimit + buffer;
    const { gasPrice } = await provider.getFeeData();
    const tx = await relayHub.relayCall(paymaster, target, encodedData, gasLimit,
      { gasLimit: gas, gasPrice });
    await tx.wait();
    return res.json({ txHash: tx.hash });
  } catch (e) {
    console.error('relayCall error →', e);
    return res.status(500).json({ error: e.message || 'relay failed' });
  }
});

/* ---------- Start ---------- */
app.listen(port, () => {
  console.log(`✅ MODL Relayer listening on port ${port}`);
});
