// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

interface IMODLPaymaster {
    function preRelayedCall(address user, uint256 gasLimit) external returns (bytes memory context);
    function postRelayedCall(address user, bytes calldata context, uint256 gasUsed) external;
}

contract MODLRelayHub {
    mapping(address => uint256) public deposits;

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event Relayed(address indexed user, address indexed paymaster, address indexed target, uint256 gasUsed);

    receive() external payable {}

    function deposit() external payable {
        require(msg.value > 0, "Zero deposit");
        deposits[msg.sender] += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        require(deposits[msg.sender] >= amount, "Insufficient balance");
        deposits[msg.sender] -= amount;
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdraw failed");
        emit Withdrawn(msg.sender, amount);
    }

    function relayCall(
        address paymaster,
        address target,
        bytes calldata data,
        uint256 gasLimit
    ) external {
        require(deposits[msg.sender] >= gasLimit * tx.gasprice, "Not enough balance for gas");

        // Call Paymaster preRelayedCall
        bytes memory context = IMODLPaymaster(paymaster).preRelayedCall(msg.sender, gasLimit);

        // Execute target
        (bool success, ) = target.call{gas: gasLimit}(data);
        require(success, "Target call failed");

        uint256 gasUsed = gasLimit - gasleft();

        // Call Paymaster postRelayedCall
        IMODLPaymaster(paymaster).postRelayedCall(msg.sender, context, gasUsed);

        // Deduct gas from sender
        deposits[msg.sender] -= gasUsed * tx.gasprice;

        emit Relayed(msg.sender, paymaster, target, gasUsed);
    }
}
