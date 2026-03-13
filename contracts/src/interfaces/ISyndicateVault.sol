// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface ISyndicateVault {
    // ── LP Functions ──
    function ragequit(address receiver) external returns (uint256 assets);

    // ── Agent Functions (Zodiac-scoped) ──
    function executeStrategy(address strategy, bytes calldata data) external returns (bytes memory);

    // ── Views ──
    function getAgentPermissions(address agent) external view returns (uint256 maxPerTx, uint256 dailyLimit, bool active);

    // ── Admin ──
    function setAgentPermissions(address agent, uint256 maxPerTx, uint256 dailyLimit) external;
    function removeAgent(address agent) external;
    function pause() external;
    function unpause() external;

    // ── Events ──
    event AgentPermissionsSet(address indexed agent, uint256 maxPerTx, uint256 dailyLimit);
    event AgentRemoved(address indexed agent);
    event StrategyExecuted(address indexed agent, address indexed strategy, bytes data);
    event Ragequit(address indexed lp, uint256 shares, uint256 assets);
}
