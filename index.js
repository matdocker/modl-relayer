app.post("/relay", async (req, res) => {
  const { paymaster, target, encodedData, gasLimit, user } = req.body;

  console.log("🚀 /relay endpoint hit");

  if (!paymaster || !target || !encodedData || !gasLimit || !user) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    console.table({ paymaster, target, gasLimit, user });

    // 🧠 Append user to calldata (ERC-2771)
    const userBytes = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [user]);
    const dataWithUser = encodedData + userBytes.slice(2);

    const feeData = await provider.getFeeData();

    const paymasterContract = new ethers.Contract(paymaster, paymasterAbi, provider);

    // 1. Relayer Status (optional)
    try {
      const relayerInfo = await relayHub.getRelayWorkerInfo.staticCall(relayerAddress);
      console.log("🔐 Relayer is trusted/staked:", relayerInfo);
    } catch {
      console.warn("⚠️ getRelayWorkerInfo not implemented — skipping check");
    }

    // 2. Paymaster deposit
    try {
      const deposit = await relayHub.deposits(paymaster);
      console.log("💰 Paymaster deposit:", ethers.formatEther(deposit), "ETH");
    } catch {
      console.warn("⚠️ Could not fetch Paymaster deposit");
    }

    // 3. Trusted config validation
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

      // ✅ Extra paranoia: check encodedData ends with user address (optional)
      if (!encodedData.endsWith(userBytes.slice(2))) {
        console.warn("⚠️ User address not properly appended to calldata");
      }
    } catch (err) {
      console.error("❌ Trusted address configuration mismatch:", err.message);
      return res.status(500).json({ error: "Trusted contract configuration error" });
    }

    // 4. Simulate relayCall via staticCall
    try {
      console.log("🔍 Simulating relayCall...");

      const relayCallTx = relayHub.relayCall(
        paymaster,
        target,
        dataWithUser,
        gasLimit,
        user
      );

      await relayCallTx.staticCall({
        from: relayerAddress,
        gasLimit: 1_000_000,
        gasPrice: feeData.gasPrice ?? undefined,
      });

      console.log("✅ staticCall.relayCall succeeded");
    } catch (staticErr) {
      console.error("❌ staticCall.relayCall failed:", staticErr.message);

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

      // 🔍 Debug fallback simulations
      try {
        await paymasterContract.preRelayedCall.staticCall(user, gasLimit);
        console.log("✅ preRelayedCall simulated");
      } catch (e) {
        console.warn("❌ preRelayedCall failed:", e.reason || e.message);
      }

      try {
        await deploymentManager.createProject.staticCall("TestProject");
        console.log("✅ createProject simulated");
      } catch (e) {
        console.warn("❌ createProject failed:", e.reason || e.message);
      }

      return res.status(500).json({ error: decodedReason });
    }

    // 5. Send Transaction via relayCall
    const txReq = await relayHub.relayCall.populateTransaction(
      paymaster,
      target,
      dataWithUser,
      gasLimit,
      user
    );

    // 🧠 Smarter gas buffer: add 20% safety margin
    const adjustedGasLimit = Math.floor(Number(gasLimit) * 1.2);

    const tx = await wallet.sendTransaction({
      ...txReq,
      gasLimit: adjustedGasLimit,
      gasPrice: feeData.gasPrice ?? undefined,
    });

    console.log("⛽ Relay tx broadcast:", tx.hash);
    const receipt = await tx.wait();

    if (receipt.status !== 1) throw new Error("Transaction reverted on-chain");

    // 🪵 Deep log analysis (RelayHub + Paymaster + DeploymentManager)
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
      modlFee: null,         // ⏳ Optional: pull from FeeManager
      userTier: null,        // ⏳ Optional: pull from TierSystem
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
