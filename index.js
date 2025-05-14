// index.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// ─── Contract setup ──────────────────────────────────────────────────────────
const relayHubAbi = require("./abi/MODLRelayHub.json").abi;
const deploymentManagerAbi = require("./abi/DeploymentManager.json").abi;

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

console.log("ENV RELAY_HUB_ADDRESS =", JSON.stringify(process.env.RELAY_HUB_ADDRESS));
const relayHub = new ethers.Contract(process.env.RELAY_HUB_ADDRESS, relayHubAbi).connect(wallet);
console.log("🛡  Using RelayHub proxy:", relayHub.target);

const deploymentManagerInterface = new ethers.Interface(deploymentManagerAbi);

app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ─── /relay endpoint ─────────────────────────────────────────────────────────
app.post("/relay", async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;

  if (!paymaster || !target || !encodedData || !gasLimit || !user) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    console.log("\n📦 Incoming relay request");
    console.table({ paymaster, target, gasLimit, user, encodedData });

    // Append user address (ERC-2771-style)
    const userBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user]);
    const dataWithUser = encodedData + userBytes.slice(2); // remove '0x'

    // ⏳ Optional: CallStatic first to simulate
    try {
      const staticResult = await relayHub.callStatic.relayCall(
        paymaster,
        target,
        dataWithUser,
        gasLimit,
        user
      );
      console.log("✅ callStatic.relayCall success:", staticResult);
    } catch (staticErr) {
      console.error("❌ callStatic.relayCall failed:", staticErr.reason || staticErr.message || staticErr);
      return res.status(500).json({
        error: staticErr.reason || staticErr.message || "callStatic.relayCall failed",
      });
    }

    // 🛰 Send transaction
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
      gasPrice: feeData.gasPrice ?? undefined,
    });

    console.log("⛽ Relay tx broadcast:", tx.hash);

    const receipt = await tx.wait();
    if (receipt.status !== 1) throw new Error("Transaction reverted on-chain");

    console.log("📬 Tx mined:", tx.hash);

    // 🔍 Debug logs
    for (const log of receipt.logs) {
      try {
        const parsed = deploymentManagerInterface.parseLog(log);
        if (parsed.name === "DebugMsgSender") {
          console.log("🪵 DebugMsgSender:", parsed.args);
        }
      } catch {
        // Ignore unrelated logs
      }
    }

    const txHash = receipt?.hash || receipt?.transactionHash;
    if (!txHash) {
      console.error("❌ Missing txHash in receipt:", receipt);
      return res.status(500).json({ error: "Transaction sent but missing hash." });
    }

    console.log("📬 Responding with txHash:", txHash);
    res.status(200).json({ txHash });

  } catch (err) {
    console.error("❌ Relay failed (outer):");
    console.dir(err, { depth: null });

    res.status(500).json({
      error: err?.error?.message || err?.reason || err?.message || "Relay error",
    });
  }
});


app.listen(port, () => {
  console.log(`✅ MODL Relayer listening on http://localhost:${port}`);
});
