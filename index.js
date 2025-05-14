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
    console.log("🔧 Encoding user address for calldata...");
    const userBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user]);
    const dataWithUser = encodedData + userBytes.slice(2); // Remove 0x
    console.log("📌 dataWithUser =", dataWithUser);

    // 🔍 Step 2: Simulate callStatic to catch on-chain errors early
    try {
      console.log("🔍 Simulating relayCall via callStatic...");

      // ⚠️ Use a provider-connected contract for callStatic
      const relayHubStatic = new ethers.Contract(
        relayHub.target,        // proxy address
        relayHub.interface,     // reuse ABI
        provider                // connected to provider, not wallet
      );

      const staticResult = await relayHubStatic.callStatic.relayCall(
        paymaster,
        target,
        dataWithUser,
        gasLimit,
        user
      );

      console.log("✅ callStatic.relayCall succeeded:", staticResult);
    } catch (staticErr) {
      console.error("❌ callStatic.relayCall failed:");
      console.dir(staticErr, { depth: null });
      return res.status(500).json({
        error: staticErr?.reason || staticErr?.message || "relayCall() reverted in simulation",
      });
    }

    // ⚙️ Step 3: Build transaction request
    console.log("🛠 Building transaction from relayHub...");
    console.log("🛠 Using relayHub at:", relayHub.target);
    console.log("🛠 Using paymaster at:", paymaster);
    console.log("🛠 Using target at:", target);
    console.log("🛠 Using user at:", user);
    const feeData = await provider.getFeeData();
    console.log("⚙️ feeData.gasPrice =", feeData.gasPrice?.toString());

    const txReq = await relayHub.relayCall.populateTransaction(
      paymaster,
      target,
      dataWithUser,
      gasLimit,
      user
    );
    console.log("🧾 txReq populated:", txReq);

    // 🚀 Step 4: Send transaction
    console.log("🚀 Sending transaction...");
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

    // 🔍 Step 6: Log any decoded events
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

    // ✅ Step 7: Return txHash
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

    res.status(500).json({
      error: err?.error?.message || err?.reason || err?.message || "Relay error",
    });
  }
});




app.listen(port, () => {
  console.log(`✅ MODL Relayer listening on http://localhost:${port}`);
});
