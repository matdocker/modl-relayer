// index.js -------------------------------------------------------------
const express = require('express');
const cors    = require('cors');
const { ethers } = require('ethers');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app  = express();
const port = parseInt(process.env.PORT || '8080', 10);   // <─ use Railway PORT
const host = '0.0.0.0';    

/* ---------- CORS --------------------------------------------------- */
const allowed = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => (!origin || allowed.includes(origin)) ? cb(null, true)
                                                               : cb(new Error(`Blocked by CORS: ${origin}`)),
  methods: ['GET','POST','OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: true
}));
app.options('*', cors());

app.listen(port, host, () => {
  console.log(`✅ MODL Relayer listening on http://${host}:${port} (env PORT=${process.env.PORT || 'undefined'})`);
});

/* ---------- Ethereum ------------------------------------------------ */
const providerUrl      = `${process.env.RPC_URL}/${process.env.THIRDWEB_API_KEY}`;
const privateKey       = process.env.PRIVATE_KEY;
const relayHubAddress  = process.env.RELAY_HUB_ADDRESS;
if (!providerUrl || !privateKey || !relayHubAddress) {
  console.error('Missing env vars'); process.exit(1);
}
const abi = JSON.parse(fs.readFileSync(path.join(__dirname,'abi/MODLRelayHub.json'))).abi;

const provider  = new ethers.JsonRpcProvider(providerUrl);
const wallet    = new ethers.Wallet(privateKey, provider);
const relayHub  = new ethers.Contract(relayHubAddress, abi, wallet);

/* ---------- Routes -------------------------------------------------- */
app.get('/health', (_, res) => res.send('✅ MODL Relayer is healthy'));

app.post('/relay', async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;
  if (!paymaster || !target || !user || typeof encodedData !== 'string' || !encodedData.startsWith('0x') || typeof gasLimit !== 'number') {
    return res.status(400).json({ error: 'Bad payload' });
  }
  try {
    const tx = await relayHub.relayCall(paymaster, target, encodedData, gasLimit, {
      gasLimit: gasLimit + 100_000,
      gasPrice: (await provider.getFeeData()).gasPrice
    });
    await tx.wait();
    res.json({ txHash: tx.hash });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Relay failed' });
  }
});

/* ---------- Start --------------------------------------------------- */
app.listen(port, '0.0.0.0', () =>
  console.log(`✅ MODL Relayer listening on :${port}`)
);
setInterval(() => console.log('⏰ heartbeat'), 60_000);
