// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal governor mock exposing only getActiveProposal(address) for
///         GuardianRegistry owner-unstake tests.
contract MockGovernorMinimal {
    mapping(address => uint256) public activeProposal;

    function setActiveProposal(address vault, uint256 proposalId) external {
        activeProposal[vault] = proposalId;
    }

    function getActiveProposal(address vault) external view returns (uint256) {
        return activeProposal[vault];
    }
}
