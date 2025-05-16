require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { ethers } = require("ethers");

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// ─── Load Contracts and ABI ──────────────────────────────────────────────────
const relayHubJson = require("./abi/MODLRelayHub.json");
const relayHubAbi = relayHubJson.abi;

const deploymentManagerJson = require("./abi/DeploymentManager.json");
const deploymentManagerAbi = deploymentManagerJson.abi;

const paymasterJson = require("./abi/MODLPaymaster.json");
const paymasterAbi = paymasterJson.abi;

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const relayerAddress = wallet.address;

const relayHubAddress = "0x2422d7712e858582D9CE8286AB38ab5Ec62f532A";
const deploymentManagerAddress = '0xBC7e41034c028724de34C7AeE97De6758fae8761';
const modlPaymasterAddress = "0xf4782DcfFEE16013bFc0337901167c9D44C687fA";

// ─── Validations ─────────────────────────────────────────────────────────────
if (!relayHubAddress || !deploymentManagerAddress || !modlPaymasterAddress) {
  console.error("❌ Missing critical env vars: RELAY_HUB_ADDRESS, DEPLOYMENT_MANAGER_ADDRESS, MODL_PAYMASTER_ADDRESS");
  console.error("relayHubAddress:",relayHubAddress,"deploymentManagerAddress:",deploymentManagerAddress, "modlPaymasterAddress:",modlPaymasterAddress)
  process.exit(1);
}

// ─── Instantiate Contracts ───────────────────────────────────────────────────
const relayHub = new ethers.Contract(relayHubAddress, relayHubAbi, wallet);
const deploymentManager = new ethers.Contract(deploymentManagerAddress, deploymentManagerAbi, provider);
const deploymentManagerInterface = new ethers.Interface(deploymentManagerAbi);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// ─── Relay Endpoint ──────────────────────────────────────────────────────────
app.post("/relay", async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;

  console.log("🚀 /relay endpoint hit");

  if (!paymaster || !target || !encodedData || !gasLimit || !user) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    console.table({ paymaster, target, gasLimit, user });

    // 🧠 Append user to calldata for ERC-2771 compatibility
    const userBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user]);
    const dataWithUser = encodedData + userBytes.slice(2);

    const feeData = await provider.getFeeData();
    const paymasterContract = new ethers.Contract(paymaster, paymasterAbi, provider);

    // 1. Relayer Status
    try {
      const relayerInfo = await relayHub.getRelayWorkerInfo.staticCall(relayerAddress);
      console.log("🔐 Relayer is trusted/staked:", relayerInfo);
    } catch {
      console.warn("⚠️ getRelayWorkerInfo not implemented — skipping check");
    }

    // 2. Paymaster Deposit Check
    try {
      const deposit = await relayHub.deposits(paymaster);
      console.log("💰 Paymaster deposit:", ethers.formatEther(deposit), "ETH");
    } catch {
      console.warn("⚠️ Could not fetch Paymaster deposit");
    }

    // 3. Trusted Config Check
    try {
      const paymasterRelayHub = await paymasterContract.getRelayHub();
      const paymasterTF = await paymasterContract.getTrustedForwarder();
      const isTF = await deploymentManager.isTrustedForwarder(paymasterTF);
      const resolvedRelayHub = await relayHub.getAddress();

      console.log("✅ Paymaster.relayHub:", paymasterRelayHub);
      console.log("✅ Paymaster.trustedForwarder:", paymasterTF);
      console.log("✅ DeploymentManager.isTrustedForwarder:", isTF);

      if (paymasterRelayHub.toLowerCase() !== resolvedRelayHub.toLowerCase()) {
        throw new Error("RelayHub mismatch on Paymaster");
      }
      if (!isTF) throw new Error("TrustedForwarder mismatch on DeploymentManager");

      if (!dataWithUser.endsWith(userBytes.slice(2))) {
        console.warn("⚠️ Appended user not found in calldata, ERC2771 may fail");
      }
    } catch (err) {
      console.error("❌ Trusted address configuration mismatch:", err.message);
      return res.status(500).json({ error: "Trusted contract configuration error" });
    }

    // 4. Simulate relayCall via callStatic
    try {
      console.log("🔍 Simulating relayCall...");

      await relayHub.callStatic.relayCall(
        paymaster,
        target,
        dataWithUser,
        gasLimit,
        user,
        {
          from: relayerAddress,
          gasLimit: 1_000_000,
          gasPrice: feeData.gasPrice ?? undefined,
        }
      );

      console.log("✅ callStatic.relayCall succeeded");
    } catch (staticErr) {
      console.error("❌ callStatic.relayCall failed:", staticErr.message);
      let decodedReason = staticErr?.reason || staticErr?.message;

      if (staticErr?.data) {
        try {
          const parsed = new ethers.Interface(relayHubAbi).parseError(staticErr.data);
          decodedReason = `${parsed.name}(${parsed.args.map(String).join(", ")})`;
        } catch {
          console.warn("⚠️ Failed to decode relayCall error");
          console.warn("Raw error data:", staticErr.data);
        }
      }

      // 🔍 Additional Debug Simulations
      try {
        await paymasterContract.preRelayedCall.staticCall(user, gasLimit);
        console.log("✅ preRelayedCall simulated");
      } catch (e) {
        console.warn("❌ preRelayedCall failed:", e.reason || e.message);
      }

      try {
        const testCalldata = deploymentManager.interface.encodeFunctionData("createProject", ["TestProject"]);
        const fullData = testCalldata + userBytes.slice(2);
        const simulation = await provider.call({
          to: target,
          data: fullData,
          from: relayerAddress,
        });
        console.log("✅ Raw call to createProject succeeded:", simulation);
      } catch (e) {
        console.warn("❌ Raw createProject call failed:", e.reason || e.message);
      }

      return res.status(500).json({ error: decodedReason });
    }

    // 5. Send Actual Transaction via RelayHub
    const txReq = await relayHub.relayCall.populateTransaction(
      paymaster,
      target,
      dataWithUser,
      gasLimit,
      user
    );

    const adjustedGasLimit = Math.floor(Number(gasLimit) * 1.2);

    const tx = await wallet.sendTransaction({
      ...txReq,
      gasLimit: adjustedGasLimit,
      gasPrice: feeData.gasPrice ?? undefined,
    });

    console.log("⛽ Relay tx broadcast:", tx.hash);
    const receipt = await tx.wait();

    if (receipt.status !== 1) throw new Error("Transaction reverted on-chain");

    // 🪵 Deep Log Debugging
    const logs = [];
    for (const log of receipt.logs) {
      try {
        const parsed = deploymentManagerInterface.parseLog(log);
        logs.push({ event: parsed.name, args: parsed.args });
        if (parsed.name === "DebugMsgSender") {
          console.log("🪵 DebugMsgSender:", parsed.args);
        }
      } catch {}
      try {
        const parsed = new ethers.Interface(relayHubAbi).parseLog(log);
        logs.push({ event: parsed.name, args: parsed.args });
      } catch {}
      try {
        const parsed = new ethers.Interface(paymasterAbi).parseLog(log);
        logs.push({ event: parsed.name, args: parsed.args });
      } catch {}
    }

    res.status(200).json({
      txHash: receipt.hash,
      gasUsed: receipt.gasUsed.toString(),
      modlFee: null,
      userTier: null,
      logs
    });

  } catch (err) {
    console.error("❌ Relay failed:", err);
    let decodedReason = err?.reason || err?.message;

    if (err?.data) {
      try {
        const parsed = new ethers.Interface(relayHubAbi).parseError(err.data);
        decodedReason = `${parsed.name}(${parsed.args.map(String).join(", ")})`;
      } catch {
        console.warn("⚠️ Failed to decode outer revert reason");
        console.warn("Raw error data:", err.data);
      }
    }

    res.status(500).json({ error: decodedReason || "Relay error" });
  }
});


// ─── Status Endpoint ─────────────────────────────────────────────────────────
app.get("/status", async (req, res) => {
  try {
    const paymaster = new ethers.Contract(modlPaymasterAddress, paymasterAbi, provider);
    const paymasterTF = await paymaster.getTrustedForwarder();
    const paymasterRelayHub = await paymaster.getRelayHub();
    const isTF = await deploymentManager.isTrustedForwarder(paymasterTF);
    const deposit = await relayHub.deposits(modlPaymasterAddress);

    let relayerInfo = null;
    try {
      relayerInfo = await relayHub.getRelayWorkerInfo.staticCall(relayerAddress);
    } catch {}

    res.status(200).json({
      status: "ok",
      paymaster: modlPaymasterAddress,
      relayHub: await relayHub.getAddress(),
      deploymentManager: deploymentManagerAddress,
      trustedForwarder: paymasterTF,
      config: {
        relayHubSet: paymasterRelayHub === await relayHub.getAddress(),
        trustedForwarderSet: isTF,
        paymasterETH: `${ethers.formatEther(deposit)} ETH`,
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
    console.error("❌ /status diagnostics failed:", err);
    res.status(500).json({ status: "error", message: err?.message || "Diagnostics error" });
  }
});

// ─── Start Server ────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`✅ MODL Relayer listening on http://localhost:${port}`);
});
