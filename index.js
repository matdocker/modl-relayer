// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");
const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Load MODLRelayHub ABI
const relayHubAbi = require("./abi/MODLRelayHub.json").abi;

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const relayHub = new ethers.Contract(process.env.RELAY_HUB_ADDRESS, relayHubAbi, wallet);

app.post("/relay", async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;
  if (!paymaster || !target || !encodedData || !gasLimit || !user) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const tx = await relayHub.relayCall(paymaster, target, encodedData, gasLimit, {
      gasLimit: gasLimit + 100_000,
      gasPrice: (await provider.getFeeData()).gasPrice,
    });

    console.log("⛽ Relay tx sent:", tx.hash);
    await tx.wait();

    res.json({ txHash: tx.hash });
  } catch (err) {
    console.error("❌ Relay failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(port, () => {
  console.log(`✅ MODL Relayer running on http://localhost:${port}`);
});
