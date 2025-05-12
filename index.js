// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app  = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// ─── Contract setup ──────────────────────────────────────────────────────────
const relayHubAbi = require("./abi/MODLRelayHub.json").abi;
const deploymentManagerAbi = require("./abi/DeploymentManager.json").abi; // ⬅️ Make sure this file exists

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

console.log("ENV RELAY_HUB_ADDRESS =", JSON.stringify(process.env.RELAY_HUB_ADDRESS));
const relayHub = new ethers.Contract(process.env.RELAY_HUB_ADDRESS, relayHubAbi, wallet);
console.log("🛡  Using RelayHub proxy:", relayHub.target);

// Optional: preload DeploymentManager contract interface for log decoding
const deploymentManagerInterface = new ethers.Interface(deploymentManagerAbi);

// ─── /relay endpoint ─────────────────────────────────────────────────────────
app.post("/relay", async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;

  if (!paymaster || !target || !encodedData || !gasLimit || !user) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    console.log("\n📦 Incoming relay request");
    console.table({ paymaster, target, gasLimit, user, encodedData });

    const userBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user]);
    const dataWithUser = encodedData + userBytes.slice(2); // remove 0x

    // 1️⃣ Simulate with callStatic to catch errors
    try {
      await relayHub.callStatic.relayCall(
        paymaster,
        target,
        dataWithUser,
        gasLimit,
        user,
        { from: wallet.address }
      );
      console.log("✅ callStatic passed – proceeding to send tx");
    } catch (simErr) {
      console.error("❌ callStatic revert reason:", simErr.reason || simErr.shortMessage);
      return res.status(500).json({ error: simErr.reason || "callStatic reverted" });
    }

    // 2️⃣ Broadcast tx
    const feeData = await provider.getFeeData();
    const txReq = await relayHub.relayCall.populateTransaction(
      paymaster,
      target,
      dataWithUser,
      gasLimit,
      user
    );

    const tx = await wallet.sendTransaction({
      ...txReq,
      gasLimit: Number(gasLimit) + 100_000,
      gasPrice: feeData.gasPrice ?? undefined
    });

    console.log("⛽ Relay tx broadcast:", tx.hash);

    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("Tx reverted on-chain");

    console.log("📬 Tx mined:", receipt.transactionHash);

    // 3️⃣ Check for DebugMsgSender event
    for (const log of receipt.logs) {
      try {
        const parsed = deploymentManagerInterface.parseLog(log);
        if (parsed.name === "DebugMsgSender") {
          console.log("🪵 DebugMsgSender event:", parsed.args);
        }
      } catch (e) {
        // Not all logs will match, so safely ignore
      }
    }

    res.json({ txHash: receipt.transactionHash });

  } catch (err) {
    console.error("❌ Relay failed:", err);
    res.status(500).json({ error: err?.reason || err?.message || "Relay error" });
  }
});

app.listen(port, () => {
  console.log(`✅ MODL Relayer listening on http://localhost:${port}`);
});
