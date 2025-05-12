// deposit.js
const { ethers } = require("ethers");
const abi = require("./abi/MODLRelayHub.json").abi;
require("dotenv").config();

(async () => {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const relayHub = new ethers.Contract(process.env.RELAY_HUB_ADDRESS, abi, wallet);

  console.log("⏳ Depositing 0.01 ETH into RelayHub…");
  const tx = await relayHub.deposit({ value: ethers.parseEther("0.01") });
  await tx.wait();
  console.log("✅ Deposit Confirmed:", tx.hash);
})();
