// encodeForwarderCall.js
const { Interface } = require("ethers");        // ← import Interface directly
// other imports if you need them:
// const { ethers } = require("ethers");

async function encode() {
  const forwarderAddress           = "0x9D630077D10272936cB368D1eE370a3Ec2b20704";
  const deploymentManagerAddress   = "0xBC7e41034c028724de34C7AeE97De6758fae8761";
  const userAddress                = "0x52F7B438B3C72d9a834FE7CBc00D78E948d706D5";
  const projectId                  = 55;

  // Create Interfaces
  const deploymentIface = new Interface([
    "function deleteProject(uint256 projectId)"
  ]);
  const forwarderIface  = new Interface([
    "function execute(address target, bytes data, address user)"
  ]);

  // Encode the inner call
  const encodedTargetData = deploymentIface.encodeFunctionData(
    "deleteProject",
    [projectId]
  );

  // Encode the forwarder execute(...) wrapper
  const encodedForwarderData = forwarderIface.encodeFunctionData(
    "execute",
    [
      deploymentManagerAddress,
      encodedTargetData,
      userAddress
    ]
  );

  console.log("✅ Encoded Forwarder Data:\n", encodedForwarderData);
}

encode();
