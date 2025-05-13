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
const relayHub = new ethers.Contract(process.env.RELAY_HUB_ADDRESS, relayHubAbi, wallet);
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

    const userBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user]);
    const dataWithUser = encodedData + userBytes.slice(2); // remove 0x

    // 1️⃣ Simulate with callStatic
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
      const fallbackReason =
        simErr?.error?.data?.message ||
        simErr?.reason ||
        simErr?.shortMessage ||
        JSON.stringify(simErr);

      console.error("❌ callStatic failed:");
      console.dir(simErr, { depth: null });

      return res.status(500).json({ error: fallbackReason });
    }

    // 2️⃣ Send transaction
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

    console.log("📬 Tx mined:", receipt.transactionHash);

    // 3️⃣ Optional: Look for logs like DebugMsgSender
    for (const log of receipt.logs) {
      try {
        const parsed = deploymentManagerInterface.parseLog(log);
        if (parsed.name === "DebugMsgSender") {
          console.log("🪵 DebugMsgSender:", parsed.args);
        }
      } catch {
        // Ignore logs that don’t match the interface
      }
    }

    res.json({ txHash: receipt.transactionHash });
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
