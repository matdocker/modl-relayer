const express = require('express');
const cors = require('cors');
const { Wallet, JsonRpcProvider } = require('ethers');
require('dotenv').config();

const relayHandler = require('./relayController');

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const provider = new JsonRpcProvider(process.env.RPC_URL);
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

app.get('/health', (req, res) => res.status(200).send('✅ MODL Relayer healthy'));

app.post('/relay', (req, res) => relayHandler(req, res, wallet, provider));

app.listen(port, () => console.log(`✅ MODL Relayer running on port ${port}`));
setInterval(() => console.log('⏰ Relayer heartbeat'), 60 * 1000);
