// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {SyndicateFactory} from "../../src/SyndicateFactory.sol";
import {SyndicateVault} from "../../src/SyndicateVault.sol";
import {SyndicateGovernor} from "../../src/SyndicateGovernor.sol";
import {ISyndicateGovernor} from "../../src/interfaces/ISyndicateGovernor.sol";
import {GuardianRegistry} from "../../src/GuardianRegistry.sol";
import {IGuardianRegistry} from "../../src/interfaces/IGuardianRegistry.sol";
import {BatchExecutorLib} from "../../src/BatchExecutorLib.sol";

import {ERC20Mock} from "../mocks/ERC20Mock.sol";
import {MockAgentRegistry} from "../mocks/MockAgentRegistry.sol";
import {MockL2Registrar} from "../mocks/MockL2Registrar.sol";

/// @title OwnerStakeAtCreation.t
/// @notice Tests for Task 26: factory creation gates on prepared owner stake,
///         binds the stake atomically, and rotateOwner retransfers the slot.
contract OwnerStakeAtCreationTest is Test {
    SyndicateFactory public factory;
    SyndicateGovernor public governor;
    SyndicateVault public vaultImpl;
    GuardianRegistry public registry;
    BatchExecutorLib public executorLib;
    ERC20Mock public usdc;
    ERC20Mock public wood;
    MockAgentRegistry public agentRegistry;
    MockL2Registrar public ensRegistrar;

    address public owner = makeAddr("factoryOwner");
    address public creator = makeAddr("creator");
    address public newOwner = makeAddr("newOwner");
    address public random = makeAddr("random");
    uint256 public creatorAgentId;
    uint256 public newOwnerAgentId;

    uint256 constant MIN_GUARDIAN_STAKE = 10_000e18;
    uint256 constant MIN_OWNER_STAKE = 10_000e18;
    uint256 constant REVIEW_PERIOD = 24 hours;
    uint256 constant BLOCK_QUORUM_BPS = 3000;

    function setUp() public {
        usdc = new ERC20Mock("USD Coin", "USDC", 6);
        wood = new ERC20Mock("WOOD", "WOOD", 18);
        executorLib = new BatchExecutorLib();
        vaultImpl = new SyndicateVault();
        agentRegistry = new MockAgentRegistry();
        ensRegistrar = new MockL2Registrar();

        creatorAgentId = agentRegistry.mint(creator);
        newOwnerAgentId = agentRegistry.mint(newOwner);

        // Governor
        SyndicateGovernor govImpl = new SyndicateGovernor();
        bytes memory govInit = abi.encodeCall(
            SyndicateGovernor.initialize,
            (ISyndicateGovernor.InitParams({
                    owner: owner,
                    votingPeriod: 1 days,
                    executionWindow: 1 days,
                    vetoThresholdBps: 4000,
                    maxPerformanceFeeBps: 3000,
                    cooldownPeriod: 1 days,
                    collaborationWindow: 48 hours,
                    maxCoProposers: 5,
                    minStrategyDuration: 1 hours,
                    maxStrategyDuration: 30 days,
                    parameterChangeDelay: 1 days,
                    protocolFeeBps: 0,
                    protocolFeeRecipient: address(0)
                }))
        );
        governor = SyndicateGovernor(address(new ERC1967Proxy(address(govImpl), govInit)));

        // Factory (guardianRegistry set below after we deploy the registry)
        SyndicateFactory factoryImpl = new SyndicateFactory();
        // Predict registry address so we can wire it into factory.initialize.
        // Cleaner: deploy registry first.
        GuardianRegistry regImpl = new GuardianRegistry();
        bytes memory regInit; // assigned after factory proxy address known

        // The registry needs the factory address, and the factory needs the
        // registry address — circular. Deploy registry first with a tentative
        // factory that we overwrite via upgrade, OR predict the factory address
        // from deployer nonce. Simplest: deploy a registry whose `factory` is
        // set to a predicted factory proxy address using `vm.computeCreateAddress`.
        address factoryProxy = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        regInit = abi.encodeCall(
            GuardianRegistry.initialize,
            (
                owner,
                address(governor),
                factoryProxy,
                address(wood),
                MIN_GUARDIAN_STAKE,
                MIN_OWNER_STAKE,
                0,
                7 days,
                REVIEW_PERIOD,
                BLOCK_QUORUM_BPS
            )
        );
        registry = GuardianRegistry(address(new ERC1967Proxy(address(regImpl), regInit)));

        bytes memory factoryInit = abi.encodeCall(
            SyndicateFactory.initialize,
            (SyndicateFactory.InitParams({
                    owner: owner,
                    executorImpl: address(executorLib),
                    vaultImpl: address(vaultImpl),
                    ensRegistrar: address(ensRegistrar),
                    agentRegistry: address(agentRegistry),
                    governor: address(governor),
                    managementFeeBps: 50,
                    guardianRegistry: address(registry)
                }))
        );
        factory = SyndicateFactory(address(new ERC1967Proxy(address(factoryImpl), factoryInit)));
        require(address(factory) == factoryProxy, "factory address prediction mismatch");

        // Hand the governor's addVault gate to the factory.
        vm.prank(owner);
        governor.setFactory(address(factory));
        // Wire registry into governor via Task 25.
        vm.prank(owner);
        governor.initializeGuardianRegistry(address(registry));

        // Fund creator with WOOD so they can prepare owner stake.
        wood.mint(creator, 100_000e18);
        wood.mint(newOwner, 100_000e18);
    }

    function _cfg(string memory sub) internal view returns (SyndicateFactory.SyndicateConfig memory) {
        return SyndicateFactory.SyndicateConfig({
            metadataURI: "ipfs://test",
            asset: usdc,
            name: "Test Vault",
            symbol: "tVault",
            openDeposits: false,
            subdomain: sub
        });
    }

    function _prepareStake(address who) internal {
        vm.prank(who);
        wood.approve(address(registry), type(uint256).max);
        vm.prank(who);
        registry.prepareOwnerStake(MIN_OWNER_STAKE);
    }

    // ──────────────────────────────────────────────────────────────
    // createSyndicate gates on prepared stake
    // ──────────────────────────────────────────────────────────────

    function test_createSyndicate_revertsIfNoPreparedStake() public {
        vm.prank(creator);
        vm.expectRevert(SyndicateFactory.PreparedStakeNotFound.selector);
        factory.createSyndicate(creatorAgentId, _cfg("no-stake"));
    }

    function test_createSyndicate_bindsPreparedStakeAtomic() public {
        _prepareStake(creator);
        assertTrue(registry.canCreateVault(creator));

        vm.prank(creator);
        (uint256 id, address vault) = factory.createSyndicate(creatorAgentId, _cfg("my-fund"));

        assertEq(id, 1);
        assertTrue(vault != address(0));
        assertTrue(registry.hasOwnerStake(vault), "owner stake bound to vault");
        assertEq(registry.ownerStake(vault), MIN_OWNER_STAKE);
        assertFalse(registry.canCreateVault(creator), "prepared stake consumed");
    }

    function test_createSyndicate_bindFailureRevertsEntireTx() public {
        _prepareStake(creator);

        // First creation consumes the prepared stake.
        vm.prank(creator);
        factory.createSyndicate(creatorAgentId, _cfg("first"));

        // Second creation: no fresh prepared stake → canCreateVault is false,
        // whole tx reverts at the gate before any side effects (atomic revert).
        vm.prank(creator);
        vm.expectRevert(SyndicateFactory.PreparedStakeNotFound.selector);
        factory.createSyndicate(creatorAgentId, _cfg("second"));
    }

    // ──────────────────────────────────────────────────────────────
    // rotateOwner
    // ──────────────────────────────────────────────────────────────

    function _createAndUnstake() internal returns (address vault) {
        _prepareStake(creator);
        vm.prank(creator);
        (, vault) = factory.createSyndicate(creatorAgentId, _cfg("rotate-fund"));

        // Creator requests and claims the owner unstake so hasOwnerStake == false.
        vm.prank(creator);
        registry.requestUnstakeOwner(vault);
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(creator);
        registry.claimUnstakeOwner(vault);
        assertFalse(registry.hasOwnerStake(vault));
    }

    function test_rotateOwner_onlyOwner() public {
        address vault = _createAndUnstake();
        _prepareStake(newOwner);

        vm.prank(random);
        vm.expectRevert();
        factory.rotateOwner(vault, newOwner);
    }

    function test_rotateOwner_revertsIfOldOwnerStillStaked() public {
        _prepareStake(creator);
        vm.prank(creator);
        (, address vault) = factory.createSyndicate(creatorAgentId, _cfg("still-staked"));

        _prepareStake(newOwner);
        vm.prank(owner);
        vm.expectRevert(SyndicateFactory.VaultStillStaked.selector);
        factory.rotateOwner(vault, newOwner);
    }

    function test_rotateOwner_revertsOnRegistryMismatch() public {
        address vault = _createAndUnstake();
        _prepareStake(newOwner);

        // Swap the governor's registry to a different address → mismatch.
        GuardianRegistry otherImpl = new GuardianRegistry();
        // Deploy a minimally-initialized second registry.
        bytes memory otherInit = abi.encodeCall(
            GuardianRegistry.initialize,
            (
                owner,
                address(governor),
                address(factory),
                address(wood),
                MIN_GUARDIAN_STAKE,
                MIN_OWNER_STAKE,
                0,
                7 days,
                REVIEW_PERIOD,
                BLOCK_QUORUM_BPS
            )
        );
        address other = address(new ERC1967Proxy(address(otherImpl), otherInit));

        // Overwrite `_guardianRegistry` on the governor via stdstore. This
        // simulates a deployer misconfiguration where factory and governor
        // ended up pointing at different registries.
        // The slot for `_guardianRegistry` is not exposed via a public getter
        // until Task 25 added `guardianRegistry()`, so we use `vm.store` with a
        // computed slot derived from a canonical anchor.
        bytes32 slot = _guardianRegistrySlot();
        vm.store(address(governor), slot, bytes32(uint256(uint160(other))));
        assertEq(governor.guardianRegistry(), other, "governor now points at other registry");

        vm.prank(owner);
        vm.expectRevert(SyndicateFactory.RegistryMismatch.selector);
        factory.rotateOwner(vault, newOwner);
    }

    function test_rotateOwner_happyPath_transfersVaultAndSlot() public {
        address vault = _createAndUnstake();
        _prepareStake(newOwner);

        vm.prank(owner);
        factory.rotateOwner(vault, newOwner);

        assertEq(SyndicateVault(payable(vault)).owner(), newOwner, "vault ownership rotated");
        assertTrue(registry.hasOwnerStake(vault), "new owner stake bound");
        assertEq(registry.ownerStake(vault), MIN_OWNER_STAKE);
        // Creator record updated so downstream NotCreator gates follow the new owner.
        (,, address recordedCreator,,,,) = factory.syndicates(factory.vaultToSyndicate(vault));
        assertEq(recordedCreator, newOwner);
    }

    /// @dev Locates the governor's `_guardianRegistry` storage slot by reading
    ///      the public view and searching a small slot window. Avoids hard-coding
    ///      a magic slot number that would silently drift.
    function _guardianRegistrySlot() internal view returns (bytes32) {
        address target = governor.guardianRegistry();
        for (uint256 i = 0; i < 200; i++) {
            bytes32 s = bytes32(i);
            if (address(uint160(uint256(vm.load(address(governor), s)))) == target) {
                return s;
            }
        }
        revert("slot not found");
    }
}
