const { ethers } = require("ethers");
const abi = require("./abi/MODLRelayHub.json").abi;

(async()=>{
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const relayHub = new ethers.Contract(process.env.RELAY_HUB_ADDRESS, abi, provider);

  const bal = await relayHub.deposits("0xf4782DcfFEE16013bFc0337901167c9D44C687fA");
  console.log("RelayHub.deposit(paymaster) =", ethers.formatEther(bal), "ETH");
})();
