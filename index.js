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
    console.table({ paymaster, target, gasLimit, user });

    // 🔧 Encode user for ERC-2771
    const userBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user]);
    const dataWithUser = encodedData + userBytes.slice(2);
    console.log("📌 dataWithUser =", dataWithUser);

    // ✅ PHASE 1: Environment & Contract Setup Validation

    // 🔐 1. Verify relayer is trusted/staked (optional fallback)
    try {
      const relayerInfo = await relayHub.getRelayWorkerInfo.staticCall(relayerAddress);
      console.log("🔐 Relayer is trusted/staked:", relayerInfo);
    } catch {
      console.warn("⚠️ getRelayWorkerInfo not implemented — skipping relayer staking check");
    }

    // 💰 2. Check Paymaster ETH balance
    try {
      const deposit = await relayHub.getDeposit.staticCall(paymaster);
      console.log("💰 Paymaster deposit:", ethers.formatEther(deposit), "ETH");

      if (deposit < ethers.parseEther("0.01")) {
        console.warn("⚠️ Low Paymaster balance — top up recommended");
      }
    } catch {
      console.warn("⚠️ Could not fetch Paymaster deposit — check if getDeposit() is exposed");
    }

    // 🛠️ 3. Check internal config on-chain
    try {
      const paymasterRelayHub = await paymaster.getRelayHub();
      const paymasterTF = await paymaster.getTrustedForwarder();
      const isTF = await deploymentManager.isTrustedForwarder(paymasterTF);

      console.log("✅ Paymaster.relayHub:", paymasterRelayHub);
      console.log("✅ Paymaster.trustedForwarder:", paymasterTF);
      console.log("✅ DeploymentManager.isTrustedForwarder:", isTF);

      if (!isTF) throw new Error("TrustedForwarder mismatch on DeploymentManager");
    } catch (err) {
      console.error("❌ Trusted address configuration mismatch:", err.message || err);
      return res.status(500).json({ error: "Trusted contract configuration error" });
    }

    // 🔍 4. Simulate staticCall for relayCall (Phase 2)
try {
  console.log("🔍 Simulating relayCall via staticCall()...");

  const iface = new ethers.Interface(relayHubAbi);
  const relayCallTx = relayHub.relayCall(
    paymaster,
    target,
    dataWithUser,
    gasLimit,
    user
  );

  const result = await relayCallTx.staticCall({
    from: relayerAddress,
    gasLimit: 1_000_000,
    gasPrice: await provider.getGasPrice()
  });

  console.log("✅ staticCall.relayCall succeeded:", result);

} catch (staticErr) {
  console.error("❌ staticCall.relayCall failed:");
  console.dir(staticErr, { depth: null });

      let decodedReason = staticErr?.reason || staticErr?.message;

      if (staticErr?.data) {
        try {
          const parsed = new ethers.Interface(relayHubAbi).parseError(staticErr.data);
          console.log("🔎 Decoded revert reason:", parsed.name, parsed.args);
          decodedReason = `${parsed.name}(${parsed.args.map(String).join(", ")})`;
        } catch {
          console.warn("⚠️ Could not decode staticCall revert reason");
        }
      }

      // 🔬 Optional: fallback simulate individual components
      try {
        const context = await paymaster.preRelayedCall.staticCall(user, gasLimit);
        console.log("✅ preRelayedCall simulated:", context);
      } catch (e) {
        console.warn("❌ preRelayedCall failed:", e.reason || e.message);
      }

      try {
        const testName = "TestProject";
        const testSim = await deploymentManager.createProject.staticCall(testName);
        console.log("✅ createProject simulated:", testSim);
      } catch (e) {
        console.warn("❌ createProject failed:", e.reason || e.message);
      }

      return res.status(500).json({
        error: decodedReason || "relayCall() reverted in simulation",
      });
    }



    // ⚙️ Build & send tx
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

    if (receipt.status !== 1) {
      console.error("❌ Transaction reverted on-chain:", receipt);
      throw new Error("Transaction reverted on-chain");
    }

    // 🪵 Debug logs
    for (const log of receipt.logs) {
      try {
        const parsed = deploymentManagerInterface.parseLog(log);
        if (parsed.name === "DebugMsgSender") {
          console.log("🪵 DebugMsgSender:", parsed.args);
        }
      } catch {
        // ignore
      }
    }

    const txHash = receipt?.hash || receipt?.transactionHash;
    if (!txHash) {
      console.error("❌ Missing txHash in receipt");
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

app.get("/status", async (req, res) => {
  try {
    const [
      paymasterRelayHub,
      paymasterTF,
      isTF,
      deposit,
      relayerInfo
    ] = await Promise.all([
      paymaster.getRelayHub(),
      paymaster.getTrustedForwarder(),
      deploymentManager.isTrustedForwarder(await paymaster.getTrustedForwarder()),
      relayHub.getDeposit.staticCall(paymaster.target),
      (async () => {
        try {
          return await relayHub.getRelayWorkerInfo.staticCall(relayerAddress);
        } catch {
          return null; // Not implemented or not needed
        }
      })()
    ]);

    const balanceEth = ethers.formatEther(deposit);

    res.status(200).json({
      status: "ok",
      paymaster: paymaster.target,
      relayHub: relayHub.target,
      deploymentManager: deploymentManager.target,
      trustedForwarder: paymasterTF,
      config: {
        relayHubSet: paymasterRelayHub === relayHub.target,
        trustedForwarderSet: isTF,
        paymasterETH: `${balanceEth} ETH`,
        relayerTrusted: relayerInfo !== null,
      },
      raw: {
        paymasterRelayHub,
        paymasterTF,
        isTrustedForwarder: isTF,
        deposit: deposit.toString(),
        relayerInfo
      }
    });

  } catch (err) {
    console.error("❌ /status diagnostics failed:");
    console.dir(err, { depth: null });

    res.status(500).json({
      status: "error",
      message: err?.message || "Internal diagnostics error",
    });
  }
});


app.listen(port, () => {
  console.log(`✅ MODL Relayer listening on http://localhost:${port}`);
});
