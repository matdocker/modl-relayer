# AGENTS.md – MODULR System Overview

## Project Summary

MODULR is a decentralized, modular smart contract marketplace that enables developers to create, deploy, and manage Web3 applications using a plug-and-play architecture. It leverages gasless meta-transactions, tier-based fee discounts, and token-based access control, with support for upgradeable contracts and trusted execution via a custom relayer network.

---

## Key Architectural Concepts

* **Gasless UX** via ERC-2771 meta-transactions
* **Tiered access** and fee logic based on MODL token staking
* **Upgradeable proxy pattern** (UUPS)
* **Relayer-powered backend** for executing transactions on behalf of users
* **Modular project lifecycle**: create → deploy templates → verify → audit

---

## Core Smart Contracts

* **MODLToken**: ERC-20 token used for access control and fee payments across the MODULR ecosystem.
* **TierSystem**: Staking-based contract that assigns users to discount tiers based on rolling MODL balances.
* **TemplateRegistry**: Stores metadata and IPFS URIs for registered and verified templates.
* **FeeManager**: Handles MODL token fee calculation, discount application, and routing to treasury, founders, and burn.
* **TemplateFactory**: Deploys smart contract templates into user projects.
* **DeploymentManager**: Manages the project lifecycle (create, deploy, delete) and ensures meta-tx compatibility.
* **AuditRegistry**: Optional module for marking templates as audited, verified, or deprecated.
* **MODLPaymaster**: Holds ETH and handles gas payments on behalf of users while charging MODL tokens.
* **StakeManager**: Governs staking operations and validator trust for the MODLRelayHub or governance use cases.
* **MinimalForwarder**: ERC-2771-compatible contract to forward user-signed meta-transactions.
* **MODLRelayHub**: Core entry point for executing meta-transactions via trusted relayers and Paymaster logic.

---

### 1. DeploymentManager

* **Purpose**: Orchestrates project lifecycle, including template deployment.
* **Key Functions**:

  * `createProject(string name)`
  * `deployTemplateToProject(bytes32 projectId, bytes32 templateId)`
  * `deleteProject(bytes32 projectId)`
* **Meta-tx**: Supports ERC-2771 via `_msgSender()`
* **Depends on**: TemplateRegistry, TemplateFactory, TierSystem, FeeManager

---

### 2. MODLPaymaster

* **Purpose**: Pays for gas on behalf of users using ETH, while collecting MODL token fees.
* **Key Features**:

  * Holds ETH for transaction relaying
  * Validates `preRelayedCall(user, gasLimit)`
  * Invokes FeeManager to charge MODL token fees
  * Supports withdrawal/deposit logic
* **RelayHub Integration**: Used by the MODLRelayHub to check/pay gas

---

### 3. MODLRelayHub

* **Purpose**: Receives meta-tx calls from backend relayer and coordinates execution.
* **Key Function**:

  * `relayCall(address paymaster, address target, bytes calldata, uint256 gasLimit, address user)`
* **Security**:

  * Only a trusted relayer can call `relayCall`
  * Paymaster is responsible for ETH reimbursement and fee checks

---

### 4. FeeManager

* **Purpose**: Calculates and deducts MODL token fees from users based on tier.
* **Logic**:

  * Interacts with TierSystem to determine user discount
  * Routes fees to: treasury (40%), founder (30%), burn (30%)
* **MODL Token**: Must be approved before relaying

---

### 5. TierSystem

* **Purpose**: Assigns users to tiers based on rolling MODL stake
* **Tiers**: Bronze, Silver, Gold, Platinum
* **Functions**:

  * `stake(uint256 amount)`
  * `getTier(address user)`
  * `evaluateTier(address user)`
  * cooldown/unstake

---

### 6. TemplateRegistry / TemplateFactory

* **Purpose**: Register, verify, and deploy smart contract templates
* **Factory**: Deploys new template instances per project
* **Registry**: Stores metadata and IPFS URIs for verified templates

---

## Meta-Transaction & Relayer Flow

1. Frontend signs data payload with user private key.
2. Relayer backend receives payload and appends user address (ERC-2771).
3. `relayCall()` is invoked on MODLRelayHub:

   * Validates target is ERC-2771 compatible
   * Pays gas using MODLPaymaster
   * Paymaster collects MODL token fee from user via FeeManager
4. Target contract (e.g. DeploymentManager) executes on user's behalf

---

## MODULR Lifecycle Roles

### 1. Builders

*Web3 product creators using modular infrastructure*

**Lifecycle Summary:**

* **Create Projects** using `DeploymentManager`.
* **Browse & Add Templates** from `TemplateRegistry` to compose functionality.
* **Deploy Modular dApps** without writing Solidity, using plug-and-play templates.
* **Benefit from Gasless UX** and tier-based MODL token fee discounts.

**Key Contracts Used:**

* `DeploymentManager`
* `TemplateRegistry`
* `TierSystem`
* `FeeManager`

---

### 2. Developers

*Smart contract authors contributing to the modular ecosystem*

**Lifecycle Summary:**

* **Register New Templates** via `TemplateFactory`.
* **Submit Templates for Audit** or self-verify them to improve trust and adoption.
* **Earn Rewards** when templates are used by Builders (e.g., royalties, MODL incentives).
* **Update Templates** with new versions and maintain compatibility.

**Key Contracts Used:**

* `TemplateFactory`
* `TemplateRegistry`
* `AuditRegistry` (optional module)
* `TierSystem` (to unlock dev rewards or premium tools)

---

### Bonus Role: Auditors

*Optional trust layer*

* Review and verify template security.
* Tag templates with metadata like `verified`, `audited`, `deprecated`.
* Could be part of a DAO or external bounty system.

---

## Developer Onboarding Steps

1. Clone the repo and install dependencies:

   ```bash
   git clone https://github.com/modlxyz/MODULR.git
   cd MODULR
   yarn install

   ```
