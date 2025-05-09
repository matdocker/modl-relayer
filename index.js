require("dotenv").config();
const express = require("express");
const { ethers } = require("ethers");

const app = express();
const port = process.env.PORT || 3000;

const provider = new ethers.JsonRpcProvider(process.env.NETWORK_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

app.get("/", (req, res) => {
  res.send("✅ MODL Relayer is running!");
});

app.get("/balance", async (req, res) => {
  const balance = await provider.getBalance(wallet.address);
  res.send(`Wallet balance: ${ethers.formatEther(balance)} ETH`);
});

app.post("/fund-paymaster", async (req, res) => {
  try {
    const paymasterAddress = process.env.MODL_PAYMASTER_PROXY;
    const amountInWei = ethers.parseEther(process.env.FUND_AMOUNT);
    const tx = await wallet.sendTransaction({
      to: paymasterAddress,
      value: amountInWei,
    });
    await tx.wait();
    res.send(`✅ Funded paymaster with ${process.env.FUND_AMOUNT} ETH, tx hash: ${tx.hash}`);
  } catch (err) {
    console.error(err);
    res.status(500).send("❌ Funding failed");
  }
});

app.listen(port, () => {
  console.log(`🚀 Relayer server listening on port ${port}`);
});
