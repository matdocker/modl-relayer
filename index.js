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

  console.log("🛰️ /relay endpoint hit");

  if (!paymaster || !target || !encodedData || !gasLimit || !user) {
    console.warn("⚠️ Missing fields in request body");
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    console.log("\n📦 Incoming relay request");
    console.table({ paymaster, target, gasLimit, user, encodedData });

    // 🔧 Step 1: Encode user for ERC-2771
    const userBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user]);
    const dataWithUser = encodedData + userBytes.slice(2);
    console.log("📌 dataWithUser =", dataWithUser);

    // 🔍 Step 2: Simulate callStatic to catch on-chain errors early
    try {
      console.log("🔍 Simulating relayCall via callStatic...");

      const relayHubStatic = new ethers.Contract(
        relayHub.target,
        relayHubAbi, // ← this is the correct ABI
        provider
      );

      const result = await relayHubStatic.callStatic.relayCall(
        paymaster,
        target,
        dataWithUser,
        gasLimit,
        user
      );

      console.log("✅ callStatic.relayCall succeeded:", result);
    } catch (staticErr) {
      console.error("❌ callStatic.relayCall failed:");
      console.dir(staticErr, { depth: null });

      let decodedReason = staticErr?.reason || staticErr?.message;

      // Try to decode custom revert reason
      if (staticErr?.data) {
        try {
          const parsed = relayHub.interface.parseError(staticErr.data);
          console.log("🔎 Decoded revert reason:", parsed.name, parsed.args);
          decodedReason = `${parsed.name}(${parsed.args.map(String).join(", ")})`;
        } catch {
          console.warn("⚠️ Failed to decode revert reason from staticErr.data");
        }
      }

      return res.status(500).json({
        error: decodedReason || "relayCall() reverted in simulation",
      });
    }

    // ⚙️ Step 3: Build transaction request
    const feeData = await provider.getFeeData();

    const txReq = await relayHub.relayCall.populateTransaction(
      paymaster,
      target,
      dataWithUser,
      gasLimit,
      user
    );
    console.log("🧾 txReq populated:", txReq);

    // 🚀 Step 4: Send transaction
    const tx = await wallet.sendTransaction({
      ...txReq,
      gasLimit: Number(gasLimit) + 100_000,
      gasPrice: feeData.gasPrice ?? undefined,
    });

    console.log("⛽ Relay tx broadcast:", tx.hash);

    // ⏳ Step 5: Wait for mining
    const receipt = await tx.wait();
    console.log("📬 Tx mined:", tx.hash);

    if (receipt.status !== 1) {
      console.error("❌ Transaction reverted on-chain:", receipt);
      throw new Error("Transaction reverted on-chain");
    }

    // 🔍 Step 6: Decode any logs
    for (const log of receipt.logs) {
      try {
        const parsed = deploymentManagerInterface.parseLog(log);
        if (parsed.name === "DebugMsgSender") {
          console.log("🪵 DebugMsgSender:", parsed.args);
        }
      } catch {
        // ignore unrelated logs
      }
    }

    const txHash = receipt?.hash || receipt?.transactionHash;
    if (!txHash) {
      console.error("❌ Missing txHash in receipt:", receipt);
      return res.status(500).json({ error: "Transaction sent but missing hash." });
    }

    console.log("✅ Responding with txHash:", txHash);
    res.status(200).json({ txHash });

  } catch (err) {
    console.error("❌ Relay failed (outer):");
    console.dir(err, { depth: null });

    let decodedReason = err?.reason || err?.message;

    if (err?.data) {
      try {
        const parsed = relayHub.interface.parseError(err.data);
        console.log("🔎 Decoded outer revert reason:", parsed.name, parsed.args);
        decodedReason = `${parsed.name}(${parsed.args.map(String).join(", ")})`;
      } catch {
        console.warn("⚠️ Failed to decode outer revert reason");
      }
    }

    res.status(500).json({
      error: decodedReason || "Relay error",
    });
  }
});





app.listen(port, () => {
  console.log(`✅ MODL Relayer listening on http://localhost:${port}`);
});
