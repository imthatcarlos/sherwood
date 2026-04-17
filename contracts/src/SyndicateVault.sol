// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ISyndicateVault} from "./interfaces/ISyndicateVault.sol";
import {ISyndicateGovernor} from "./interfaces/ISyndicateGovernor.sol";
import {ISyndicateFactory} from "./interfaces/ISyndicateFactory.sol";
import {BatchExecutorLib} from "./BatchExecutorLib.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {
    ERC20VotesUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {OwnableUpgradeable} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {Initializable} from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ERC721Holder} from "@openzeppelin/contracts/token/ERC721/utils/ERC721Holder.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/**
 * @title SyndicateVault
 * @notice ERC-4626 vault for agent-managed investment syndicates.
 *
 *   The vault is the onchain identity — it holds all positions (mTokens, borrows,
 *   swapped tokens) via delegatecall to a shared BatchExecutorLib. Deploy one
 *   executor lib, share it across all syndicates.
 *
 *   Strategy execution goes through the governor via proposals. Owner retains
 *   executeBatch for manual vault management (e.g. recovering stuck tokens).
 *
 *   Inherits ERC20VotesUpgradeable to provide proper vote checkpointing for
 *   the governor's snapshot-based voting system.
 *
 *   Deployed as ERC-1967 UUPS proxy. Upgradeable only via the factory when upgrades are enabled.
 */
contract SyndicateVault is
    ISyndicateVault,
    Initializable,
    ERC4626Upgradeable,
    ERC20VotesUpgradeable,
    OwnableUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable,
    ERC721Holder
{
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // ==================== STORAGE ====================

    /// @notice Agent address => agent config
    mapping(address => AgentConfig) private _agents;

    /// @notice Set of all registered agent addresses
    EnumerableSet.AddressSet private _agentSet;

    // ── New storage (appended after existing slots) ──

    /// @notice Shared executor lib (stateless, called via delegatecall)
    address private _executorImpl;

    /// @notice Approved depositor addresses (whitelist for deposits)
    EnumerableSet.AddressSet private _approvedDepositors;

    /// @notice If true, anyone can deposit (skip whitelist check)
    bool private _openDeposits;

    /// @notice ERC-8004 agent identity registry (ERC-721)
    IERC721 private _agentRegistry;

    // ── Governor / Factory storage ──

    /// @notice Vault owner's management fee on strategy profits (basis points, set at init)
    uint256 private _managementFeeBps;

    /// @notice Factory that deployed this vault (controls upgrades, provides governor address)
    address private _factory;

    /// @dev Reserved storage for future upgrades
    uint256[40] private __gap;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(InitParams memory p) external initializer {
        if (p.owner == address(0)) revert InvalidOwner();
        if (p.executorImpl == address(0)) revert InvalidExecutorImpl();
        // NOTE: agentRegistry can be address(0) on chains without ERC-8004

        __ERC4626_init(IERC20(p.asset));
        __ERC20_init(p.name, p.symbol);
        __EIP712_init(p.name, "1");
        __Ownable_init(p.owner);
        __Pausable_init();

        _executorImpl = p.executorImpl;
        _openDeposits = p.openDeposits;
        _agentRegistry = IERC721(p.agentRegistry);
        _managementFeeBps = p.managementFeeBps;
        _factory = msg.sender;
    }

    // ==================== BATCH EXECUTION ====================

    /// @inheritdoc ISyndicateVault
    /// @dev Owner-only for manual vault management (e.g. recovering stuck tokens).
    ///      Strategy execution goes through the governor via executeGovernorBatch.
    function executeBatch(BatchExecutorLib.Call[] calldata calls) external onlyOwner whenNotPaused {
        (bool success, bytes memory returnData) =
            _executorImpl.delegatecall(abi.encodeCall(BatchExecutorLib.executeBatch, (calls)));
        if (!success) {
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
    }

    // ==================== DEPOSITOR WHITELIST ====================

    /// @inheritdoc ISyndicateVault
    function approveDepositor(address depositor) external onlyOwner {
        if (depositor == address(0)) revert InvalidDepositor();
        if (!_approvedDepositors.add(depositor)) revert DepositorAlreadyApproved();
        emit DepositorApproved(depositor);
    }

    /// @inheritdoc ISyndicateVault
    function removeDepositor(address depositor) external onlyOwner {
        if (!_approvedDepositors.remove(depositor)) revert DepositorNotApproved();
        emit DepositorRemoved(depositor);
    }

    /// @inheritdoc ISyndicateVault
    function approveDepositors(address[] calldata depositors) external onlyOwner {
        for (uint256 i = 0; i < depositors.length; i++) {
            if (depositors[i] == address(0)) revert InvalidDepositor();
            _approvedDepositors.add(depositors[i]);
            emit DepositorApproved(depositors[i]);
        }
    }

    /// @inheritdoc ISyndicateVault
    function isApprovedDepositor(address depositor) external view returns (bool) {
        return _approvedDepositors.contains(depositor);
    }

    /// @inheritdoc ISyndicateVault
    function getApprovedDepositors() external view returns (address[] memory) {
        return _approvedDepositors.values();
    }

    /// @inheritdoc ISyndicateVault
    function setOpenDeposits(bool open) external onlyOwner {
        _openDeposits = open;
        emit OpenDepositsUpdated(open);
    }

    /// @inheritdoc ISyndicateVault
    function openDeposits() external view returns (bool) {
        return _openDeposits;
    }

    // ==================== VIEWS ====================

    /// @inheritdoc ISyndicateVault
    function getAgentConfig(address agentAddress) external view returns (AgentConfig memory) {
        return _agents[agentAddress];
    }

    /// @inheritdoc ISyndicateVault
    function getAgentCount() external view returns (uint256) {
        return _agentSet.length();
    }

    /// @inheritdoc ISyndicateVault
    function isAgent(address agentAddress) external view returns (bool) {
        return _agents[agentAddress].active;
    }

    /// @inheritdoc ISyndicateVault
    function getExecutorImpl() external view returns (address) {
        return _executorImpl;
    }

    /// @inheritdoc ISyndicateVault
    function factory() external view returns (address) {
        return _factory;
    }

    // ==================== ADMIN ====================

    /// @inheritdoc ISyndicateVault
    function registerAgent(uint256 agentId, address agentAddress) external onlyOwner {
        if (agentAddress == address(0)) revert ZeroAddress();
        if (_agents[agentAddress].active) revert AgentAlreadyRegistered();

        // Verify ERC-8004 identity (skipped on chains without agent registry)
        if (address(_agentRegistry) != address(0)) {
            address nftOwner = _agentRegistry.ownerOf(agentId);
            if (nftOwner != agentAddress && nftOwner != owner()) revert NotAgentOwner();
        }

        _agents[agentAddress] = AgentConfig({agentId: agentId, agentAddress: agentAddress, active: true});

        _agentSet.add(agentAddress);

        emit AgentRegistered(agentId, agentAddress);
    }

    /// @inheritdoc ISyndicateVault
    function removeAgent(address agentAddress) external onlyOwner {
        if (!_agents[agentAddress].active) revert AgentNotActive();

        _agents[agentAddress].active = false;
        _agentSet.remove(agentAddress);

        emit AgentRemoved(agentAddress);
    }

    /// @inheritdoc ISyndicateVault
    function pause() external onlyOwner {
        _pause();
    }

    /// @inheritdoc ISyndicateVault
    function unpause() external onlyOwner {
        _unpause();
    }

    // ==================== GOVERNOR ====================

    modifier onlyGovernor() {
        if (msg.sender != _getGovernor()) revert NotGovernor();
        _;
    }

    /// @dev Read governor address from factory
    function _getGovernor() internal view returns (address) {
        return ISyndicateFactory(_factory).governor();
    }

    /// @inheritdoc ISyndicateVault
    /// @dev Re-verifies the ERC-8004 identity of the proposing agent at execute time.
    ///      Registration-time-only checks are insufficient: if an agent's NFT is transferred or
    ///      sold after registration, the original agent wallet would otherwise retain execute
    ///      rights. We read the active proposal's proposer from the governor, look up the stored
    ///      AgentConfig, and re-check `_agentRegistry.ownerOf(agentId) == agentAddress`.
    ///
    ///      Option chosen: in-path re-check inside executeGovernorBatch, using only existing
    ///      governor view methods (getActiveProposal + getProposal). This requires no interface
    ///      changes on the governor (parallel work is editing it). Cost: one external SLOAD-style
    ///      call to the governor plus one ERC-721 ownerOf lookup per execute / settle batch.
    ///
    ///      Skipped when:
    ///        - `_agentRegistry` is unset (chain has no ERC-8004 registry, matching registerAgent).
    ///        - Proposer is not a registered agent (e.g. owner-initiated proposal; caller auth
    ///          has already been validated by onlyGovernor).
    function executeGovernorBatch(BatchExecutorLib.Call[] calldata calls) external onlyGovernor {
        _verifyActiveAgentIdentity();
        _runGovernorBatch(calls);
    }

    /// @inheritdoc ISyndicateVault
    /// @notice Settlement counterpart to executeGovernorBatch — does NOT re-check agent identity.
    /// @dev Settlement MUST always be able to recover capital, including when the proposing agent's
    ///      ERC-8004 NFT has been revoked/transferred. Re-checking identity on the close path would
    ///      trap funds: emergencyCancel cannot cancel an already-Executed proposal, so a revoked
    ///      agent would strand capital in the strategy clone with no recovery path. Governor calls
    ///      this function from settleProposal, settleProposal's fallback, and emergencySettle;
    ///      authentication is still enforced via onlyGovernor.
    function settleGovernorBatch(BatchExecutorLib.Call[] calldata calls) external onlyGovernor {
        _runGovernorBatch(calls);
    }

    /// @dev Shared delegatecall-into-BatchExecutorLib body used by both execute and settle paths.
    function _runGovernorBatch(BatchExecutorLib.Call[] calldata calls) internal {
        (bool success, bytes memory returnData) =
            _executorImpl.delegatecall(abi.encodeCall(BatchExecutorLib.executeBatch, (calls)));
        if (!success) {
            assembly {
                revert(add(returnData, 32), mload(returnData))
            }
        }
    }

    /// @dev Re-verify that the active proposal's proposer still owns their ERC-8004 agent NFT.
    ///      No-op when the registry is unset or the proposer is not a registered agent.
    function _verifyActiveAgentIdentity() internal view {
        IERC721 registry = _agentRegistry;
        if (address(registry) == address(0)) return;

        address gov = _getGovernor();
        uint256 activeProposalId = ISyndicateGovernor(gov).getActiveProposal(address(this));
        if (activeProposalId == 0) return;

        address proposer = ISyndicateGovernor(gov).getProposal(activeProposalId).proposer;
        AgentConfig storage cfg = _agents[proposer];
        if (!cfg.active) return;

        if (registry.ownerOf(cfg.agentId) != cfg.agentAddress) {
            revert AgentIdentityRevoked(cfg.agentId, cfg.agentAddress);
        }
    }

    /// @inheritdoc ISyndicateVault
    function transferPerformanceFee(address asset, address to, uint256 amount) external onlyGovernor {
        IERC20(asset).safeTransfer(to, amount);
    }

    /// @inheritdoc ISyndicateVault
    function governor() external view returns (address) {
        return _getGovernor();
    }

    /// @inheritdoc ISyndicateVault
    function redemptionsLocked() public view returns (bool) {
        address gov = _getGovernor();
        if (gov == address(0)) return false;
        return ISyndicateGovernor(gov).getActiveProposal(address(this)) != 0;
    }

    /// @inheritdoc ISyndicateVault
    function managementFeeBps() external view returns (uint256) {
        return _managementFeeBps;
    }

    // ==================== OVERRIDES ====================

    /// @dev Resolve diamond between ERC20Upgradeable and ERC20VotesUpgradeable
    function _update(address from, address to, uint256 value)
        internal
        override(ERC20Upgradeable, ERC20VotesUpgradeable)
    {
        super._update(from, to, value);
    }

    /// @dev Use timestamp-based voting checkpoints instead of block numbers
    function clock() public view override returns (uint48) {
        return uint48(block.timestamp);
    }

    /// @dev EIP-6372: declare timestamp-based clock
    // solhint-disable-next-line func-name-mixedcase
    function CLOCK_MODE() public pure override returns (string memory) {
        return "mode=timestamp";
    }

    /// @dev Resolve decimals diamond between ERC20Upgradeable and ERC4626Upgradeable
    function decimals() public view override(ERC4626Upgradeable, ERC20Upgradeable) returns (uint8) {
        return super.decimals();
    }

    /// @dev Virtual shares offset = asset decimals → mitigates ERC-4626 inflation/donation attack.
    ///      With USDC (6 decimals) this gives 12-decimal shares, making the attack economically infeasible.
    function _decimalsOffset() internal view virtual override returns (uint8) {
        return uint8(IERC20Metadata(asset()).decimals());
    }

    /// @dev Block deposits when paused or depositor not approved.
    ///      Auto-delegate to self on first deposit so shareholders get voting power.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
    {
        if (redemptionsLocked()) revert DepositsLocked();
        if (!_openDeposits && !_approvedDepositors.contains(receiver)) revert NotApprovedDepositor();
        super._deposit(caller, receiver, assets, shares);

        // Auto-delegate: if receiver has no delegate, delegate to self
        if (delegates(receiver) == address(0)) {
            _delegate(receiver, receiver);
        }
    }

    function _withdraw(address caller, address receiver, address _owner, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
    {
        if (redemptionsLocked()) revert RedemptionsLocked();
        super._withdraw(caller, receiver, _owner, assets, shares);
    }

    // ==================== RESCUE ====================

    /// @notice Rescue ETH accidentally sent to the vault
    function rescueEth(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        Address.sendValue(to, amount);
    }

    /// @notice Rescue ERC-20 tokens accidentally sent to the vault (not the vault asset).
    ///         Blocked during active proposals to protect strategy position tokens.
    function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
        if (redemptionsLocked()) revert RedemptionsLocked();
        if (to == address(0)) revert ZeroAddress();
        address asset = asset();
        if (token == asset) revert CannotRescueAsset();
        IERC20(token).safeTransfer(to, amount);
    }

    /// @notice Rescue ERC-721 tokens accidentally sent to the vault.
    ///         Blocked during active proposals to protect strategy position NFTs (e.g., Uniswap V3 LP).
    function rescueERC721(address token, uint256 tokenId, address to) external onlyOwner {
        if (redemptionsLocked()) revert RedemptionsLocked();
        if (to == address(0)) revert ZeroAddress();
        IERC721(token).safeTransferFrom(address(this), to, tokenId);
    }

    // ==================== UUPS ====================

    /// @dev Only the factory can authorize upgrades.
    function _authorizeUpgrade(address) internal view override {
        if (msg.sender != _factory) revert NotFactory();
    }

    // ==================== RECEIVE ====================

    /// @notice Accept ETH (needed for WETH unwrapping and protocol interactions)
    receive() external payable {}
}
