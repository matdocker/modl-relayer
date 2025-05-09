// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

contract MODLPaymaster is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable,
    ReentrancyGuardUpgradeable
{
    address private _trustedForwarder;

    event TrustedForwarderUpdated(address newForwarder);
    event ETHDeposited(address indexed from, uint256 amount);
    event ETHWithdrawn(address indexed to, uint256 amount);
    event GaslessTransactionExecuted(address indexed user, address indexed target, bytes data, uint256 gasUsed);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address trustedForwarder_) public initializer {
        require(owner_ != address(0), "owner =0");
        require(trustedForwarder_ != address(0), "fwd =0");

        __Ownable_init(owner_);
        __UUPSUpgradeable_init();
        __ReentrancyGuard_init();

        _trustedForwarder = trustedForwarder_;
    }

    /// ===== Admin functions =====

    function updateTrustedForwarder(address newForwarder) external onlyOwner {
        require(newForwarder != address(0), "Invalid forwarder");
        _trustedForwarder = newForwarder;
        emit TrustedForwarderUpdated(newForwarder);
    }

    function depositETH() external payable {
        require(msg.value > 0, "No ETH sent");
        emit ETHDeposited(msg.sender, msg.value);
    }

    function withdrawETH(address payable to, uint256 amount) external onlyOwner nonReentrant {
        require(address(this).balance >= amount, "Insufficient balance");
        to.transfer(amount);
        emit ETHWithdrawn(to, amount);
    }

    /// ===== Gasless transaction executor =====

    function executeGaslessTransaction(
        address target,
        bytes calldata data
    ) external nonReentrant {
        require(msg.sender == _trustedForwarder, "Only forwarder allowed");
        require(target != address(0), "Invalid target");

        uint256 startGas = gasleft();

        // Call the target contract
        (bool success, ) = target.call(data);
        require(success, "Gasless transaction failed");

        uint256 gasUsed = startGas - gasleft();

        emit GaslessTransactionExecuted(_msgSender(), target, data, gasUsed);
    }

    /// ===== Public views =====

    function getTrustedForwarder() external view returns (address) {
        return _trustedForwarder;
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
    /// ===== ETH Receiver =====
    receive() external payable {
        emit ETHDeposited(msg.sender, msg.value);
    }

    /// ===== UUPS authorization =====

    function _authorizeUpgrade(address) internal override onlyOwner {}

    /// ===== Meta-tx compatible sender =====

    function _msgSender() internal view override returns (address sender) {
        if (msg.sender == _trustedForwarder && msg.data.length >= 20) {
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }
}
