const { ethers } = require('ethers');

async function relayHandler(req, res, wallet, provider) {
    try {
        const { paymaster, target, data, gasLimit } = req.body;

        if (!paymaster || !target || !data || !gasLimit) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        console.log(`🛠 Relay request → Paymaster: ${paymaster}, Target: ${target}, GasLimit: ${gasLimit}`);

        const abi = [
            'function preRelayedCall(address user, uint256 gasLimit) external returns (bytes)',
            'function postRelayedCall(address user, bytes context, uint256 gasUsed) external'
        ];
        const paymasterContract = new ethers.Contract(paymaster, abi, wallet);

        const gasPrice = await provider.getGasPrice();
        const relayerBalance = await provider.getBalance(wallet.address);

        const estCost = ethers.BigNumber.from(gasLimit).mul(gasPrice);
        if (relayerBalance.lt(estCost)) {
            return res.status(500).json({ error: 'Insufficient relayer balance' });
        }

        // 1️⃣ preRelayedCall → get context
        const context = await paymasterContract.preRelayedCall(req.body.user, gasLimit);
        console.log('✅ preRelayedCall done, context →', context);

        // 2️⃣ execute target contract
        const tx = await wallet.sendTransaction({
            to: target,
            data,
            gasLimit
        });
        console.log(`🚀 Sent target tx → ${tx.hash}`);
        await tx.wait();
        console.log('✅ Target tx confirmed');

        // 3️⃣ postRelayedCall → finalize
        const gasUsed = gasLimit; // optionally measure real gas used
        await paymasterContract.postRelayedCall(req.body.user, context, gasUsed);
        console.log('✅ postRelayedCall done');

        return res.json({ success: true, txHash: tx.hash });

    } catch (err) {
        console.error('❌ Relay error:', err);
        return res.status(500).json({ error: err.message });
    }
}

module.exports = relayHandler;
