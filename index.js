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
    console.log("📦 Incoming relay request:");
    console.log("  → Paymaster:", paymaster);
    console.log("  → Target:", target);
    console.log("  → EncodedData:", encodedData);
    console.log("  → GasLimit:", gasLimit);
    console.log("  → User:", user);

    const feeData = await provider.getFeeData();

    const txRequest = await relayHub.relayCall.populateTransaction(
      paymaster,
      target,
      encodedData,
      gasLimit
    );

    const tx = await wallet.sendTransaction({
      ...txRequest,
      gasLimit: gasLimit + 100000,
      gasPrice: feeData.gasPrice,
    });

    console.log("⛽ Relay tx sent:", tx.hash);
    const receipt = await tx.wait();
    console.log("📬 Tx mined:", receipt.transactionHash);

    res.json({ txHash: tx.hash });
  } catch (err) {
    console.error("❌ Relay failed:", err);
    res.status(500).json({ error: err?.message || "Relay error" });
  }

});

app.listen(port, () => {
  console.log(`✅ MODL Relayer running on http://localhost:${port}`);
});
