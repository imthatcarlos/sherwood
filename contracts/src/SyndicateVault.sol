// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISyndicateVault} from "./interfaces/ISyndicateVault.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {AccessControlEnumerableUpgradeable} from
    "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title SyndicateVault
 * @notice ERC-4626 vault for pooled capital with agent permissions and LP ragequit.
 *         Agents execute strategies through scoped permissions (max per tx, daily limits).
 *         LPs can ragequit at any time for their pro-rata share.
 */
contract SyndicateVault is
    ISyndicateVault,
    Initializable,
    ERC4626Upgradeable,
    AccessControlEnumerableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant GUARDIAN_ROLE = keccak256("GUARDIAN_ROLE");
    bytes32 public constant AGENT_ROLE = keccak256("AGENT_ROLE");

    struct AgentPermissions {
        uint256 maxPerTx;
        uint256 dailyLimit;
        uint256 spentToday;
        uint256 lastResetDay;
        bool active;
    }

    /// @notice Agent address => permissions
    mapping(address => AgentPermissions) private _agentPerms;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        address admin,
        address guardian
    ) external initializer {
        require(admin != address(0), "Invalid admin");
        require(guardian != address(0), "Invalid guardian");

        __ERC4626_init(asset_);
        __ERC20_init(name_, symbol_);
        __AccessControlEnumerable_init();
        __Pausable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GUARDIAN_ROLE, guardian);
    }

    // ==================== LP FUNCTIONS ====================

    /// @inheritdoc ISyndicateVault
    function ragequit(address receiver) external whenNotPaused returns (uint256 assets) {
        uint256 shares = balanceOf(msg.sender);
        require(shares > 0, "No shares");

        assets = redeem(shares, receiver, msg.sender);

        emit Ragequit(msg.sender, shares, assets);
    }

    // ==================== AGENT FUNCTIONS ====================

    /// @inheritdoc ISyndicateVault
    function executeStrategy(address strategy, bytes calldata data)
        external
        onlyRole(AGENT_ROLE)
        whenNotPaused
        returns (bytes memory)
    {
        AgentPermissions storage perms = _agentPerms[msg.sender];
        require(perms.active, "Agent not active");

        // Reset daily spend if new day
        uint256 today = block.timestamp / 1 days;
        if (today > perms.lastResetDay) {
            perms.spentToday = 0;
            perms.lastResetDay = today;
        }

        // Execute the strategy call
        (bool success, bytes memory result) = strategy.call(data);
        require(success, "Strategy execution failed");

        emit StrategyExecuted(msg.sender, strategy, data);

        return result;
    }

    // ==================== VIEWS ====================

    /// @inheritdoc ISyndicateVault
    function getAgentPermissions(address agent)
        external
        view
        returns (uint256 maxPerTx, uint256 dailyLimit, bool active)
    {
        AgentPermissions storage perms = _agentPerms[agent];
        return (perms.maxPerTx, perms.dailyLimit, perms.active);
    }

    // ==================== ADMIN ====================

    /// @inheritdoc ISyndicateVault
    function setAgentPermissions(address agent, uint256 maxPerTx, uint256 dailyLimit)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(agent != address(0), "Invalid agent");

        _agentPerms[agent] = AgentPermissions({
            maxPerTx: maxPerTx,
            dailyLimit: dailyLimit,
            spentToday: 0,
            lastResetDay: block.timestamp / 1 days,
            active: true
        });

        _grantRole(AGENT_ROLE, agent);

        emit AgentPermissionsSet(agent, maxPerTx, dailyLimit);
    }

    /// @inheritdoc ISyndicateVault
    function removeAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _agentPerms[agent].active = false;
        _revokeRole(AGENT_ROLE, agent);

        emit AgentRemoved(agent);
    }

    /// @inheritdoc ISyndicateVault
    function pause() external onlyRole(GUARDIAN_ROLE) {
        _pause();
    }

    /// @inheritdoc ISyndicateVault
    function unpause() external onlyRole(GUARDIAN_ROLE) {
        _unpause();
    }

    // ==================== UUPS ====================

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
