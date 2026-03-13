// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title BatchExecutor
 * @notice Generic batched call executor for DeFi strategies.
 *
 *   Agents construct batches of arbitrary contract calls off-chain and submit
 *   them atomically. The executor enforces a target allowlist — only approved
 *   protocol contracts can be called. Intelligence lives in the CLI; this
 *   contract is a secure, dumb pipe.
 *
 *   Simulation: CLI calls executeBatch() via eth_call to dry-run the batch
 *   without committing state. If any call reverts, simulation shows why.
 *
 *   Security layers:
 *     1. Target allowlist (on-chain) — only approved contracts callable
 *     2. Vault caps (on-chain) — per-tx and daily limits in SyndicateVault
 *     3. Lit policies (off-chain) — agent-level restrictions on what PKP can sign
 *     4. CLI simulation (off-chain) — dry-run before submitting
 *
 *   Called exclusively by SyndicateVault.executeStrategy().
 */
contract BatchExecutor is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    struct Call {
        address target;
        bytes data;
        uint256 value;
    }

    struct CallResult {
        bool success;
        bytes returnData;
    }

    /// @notice Set of approved target contracts
    EnumerableSet.AddressSet private _allowedTargets;

    /// @notice The vault that owns this executor
    address public immutable vault;

    event TargetAdded(address indexed target);
    event TargetRemoved(address indexed target);
    event BatchExecuted(uint256 callCount);
    event CallExecuted(uint256 indexed index, address indexed target, bool success);

    modifier onlyVault() {
        require(msg.sender == vault, "Only vault");
        _;
    }

    constructor(address vault_, address owner_) Ownable(owner_) {
        require(vault_ != address(0), "Invalid vault");
        vault = vault_;
    }

    // ==================== EXECUTION ====================

    /// @notice Execute a batch of calls atomically
    /// @dev Called by vault.executeStrategy(). All calls must succeed or entire batch reverts.
    ///      CLI should simulate via eth_call first to catch failures before submitting.
    /// @param calls Array of (target, data, value) to execute in order
    function executeBatch(Call[] calldata calls) external onlyVault {
        for (uint256 i = 0; i < calls.length; i++) {
            require(_allowedTargets.contains(calls[i].target), "Target not allowed");

            (bool success, bytes memory returnData) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            if (!success) {
                // Bubble up the revert reason
                assembly {
                    revert(add(returnData, 32), mload(returnData))
                }
            }

            emit CallExecuted(i, calls[i].target, true);
        }

        emit BatchExecuted(calls.length);
    }

    /// @notice Simulate a batch without reverting — returns success/failure per call
    /// @dev Use this via eth_call for detailed simulation results.
    ///      NOTE: state changes from earlier calls ARE visible to later calls within
    ///      the simulation, matching real execution behavior.
    /// @param calls Array of calls to simulate
    /// @return results Array of (success, returnData) per call
    function simulateBatch(Call[] calldata calls) external returns (CallResult[] memory results) {
        results = new CallResult[](calls.length);

        for (uint256 i = 0; i < calls.length; i++) {
            if (!_allowedTargets.contains(calls[i].target)) {
                results[i] = CallResult({success: false, returnData: bytes("Target not allowed")});
                continue;
            }

            (bool success, bytes memory returnData) = calls[i].target.call{value: calls[i].value}(calls[i].data);
            results[i] = CallResult({success: success, returnData: returnData});
        }
    }

    // ==================== TARGET MANAGEMENT ====================

    /// @notice Add a protocol contract to the allowlist
    /// @param target The contract address to allow (e.g., Moonwell mToken, Uniswap Router)
    function addTarget(address target) external onlyOwner {
        require(target != address(0), "Invalid target");
        require(_allowedTargets.add(target), "Already allowed");
        emit TargetAdded(target);
    }

    /// @notice Remove a protocol contract from the allowlist
    function removeTarget(address target) external onlyOwner {
        require(_allowedTargets.remove(target), "Not in allowlist");
        emit TargetRemoved(target);
    }

    /// @notice Add multiple targets at once
    function addTargets(address[] calldata targets) external onlyOwner {
        for (uint256 i = 0; i < targets.length; i++) {
            require(targets[i] != address(0), "Invalid target");
            _allowedTargets.add(targets[i]);
            emit TargetAdded(targets[i]);
        }
    }

    // ==================== VIEWS ====================

    /// @notice Check if a target is in the allowlist
    function isAllowedTarget(address target) external view returns (bool) {
        return _allowedTargets.contains(target);
    }

    /// @notice Get all allowed targets
    function getAllowedTargets() external view returns (address[] memory) {
        return _allowedTargets.values();
    }

    /// @notice Number of allowed targets
    function allowedTargetCount() external view returns (uint256) {
        return _allowedTargets.length();
    }

    /// @notice Accept ETH (needed for unwrapping WETH etc.)
    receive() external payable {}
}
