// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IGuardianRegistry (minimal stub)
/// @notice Minimal interface surface required by GovernorEmergency.
///         Full interface (staking, slashing, guardian enumeration) lives in Task 3.
/// TODO(task-3): replace stub with real IGuardianRegistry
interface IGuardianRegistry {
    /// @notice Review window (seconds) for an opened emergency review.
    function reviewPeriod() external view returns (uint256);

    /// @notice Currently locked stake an owner has posted as collateral.
    function ownerStake(address owner) external view returns (uint256);

    /// @notice Required owner bond for opening an emergency review on a given vault.
    function requiredOwnerBond(address vault) external view returns (uint256);

    /// @notice Opens a review on an emergency settle proposal.
    /// @param proposalId governor proposal id
    /// @param callsHash hash of the pre-committed emergency calls being reviewed
    function openEmergencyReview(uint256 proposalId, bytes32 callsHash) external;

    /// @notice Resolves an open review (success = proceed, else revert in governor).
    function resolveEmergencyReview(uint256 proposalId) external;
}
