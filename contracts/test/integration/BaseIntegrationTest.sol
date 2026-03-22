// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SyndicateGovernor} from "../../src/SyndicateGovernor.sol";
import {ISyndicateGovernor} from "../../src/interfaces/ISyndicateGovernor.sol";
import {SyndicateVault} from "../../src/SyndicateVault.sol";
import {SyndicateFactory} from "../../src/SyndicateFactory.sol";
import {BatchExecutorLib} from "../../src/BatchExecutorLib.sol";

/**
 * @title BaseIntegrationTest
 * @notice Abstract base for fork-based integration tests against real Base mainnet
 *         contracts. Reads deployed Sherwood addresses from chains/8453.json and
 *         creates a test syndicate with funded LPs for each test.
 *
 * @dev Run with: forge test --fork-url $BASE_RPC_URL --match-path test/integration/**
 */
abstract contract BaseIntegrationTest is Test {
    // ── External protocol addresses (Base mainnet) ──

    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant MOONWELL_MUSDC = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant MOONWELL_MWETH = 0x628ff693426583D9a7FB391E54366292F509D457;
    address constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant AERO_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERO_FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;
    address constant AERO_TOKEN = 0x940181a94A35A4569E4529A3CDfB74e38FD98631;
    address constant VVV_TOKEN = 0xacfE6019Ed1A7Dc6f7B508C02d1b04ec88cC21bf;
    address constant SVVV = 0x321b7ff75154472B18EDb199033fF4D116F340Ff;
    address constant WST_ETH = 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452;
    address constant UNISWAP_ROUTER = 0x2626664c2603336E57B271c5C0b26F421741e481;

    // ── ERC-8004 agent identity registry (Base mainnet) ──

    address constant AGENT_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    // ── ENS registrar (Base mainnet) ──

    address constant ENS_REGISTRAR = 0x866996c808E6244216a3d0df15464FCF5d495394;

    // ── Test actors ──

    address owner = makeAddr("owner");
    address agent = makeAddr("agent");
    address lp1 = makeAddr("lp1");
    address lp2 = makeAddr("lp2");
    address random = makeAddr("random");

    // ── State ──

    SyndicateGovernor governor;
    SyndicateFactory factory;
    SyndicateVault vault;
    address deployer;
    uint256 agentNftId = 42;

    // ── Setup ──

    function setUp() public virtual {
        // Read deployed Sherwood addresses from chains/8453.json
        factory = SyndicateFactory(_readAddress("SYNDICATE_FACTORY"));
        governor = SyndicateGovernor(_readAddress("SYNDICATE_GOVERNOR"));
        deployer = _readAddress("DEPLOYER");

        // Create a test syndicate (vault + agent registration)
        _createTestSyndicate();

        // Fund LPs and deposit into vault
        _fundAndDeposit(60_000e6, 40_000e6);

        // Warp 1 second so snapshot block is in the past for voting
        vm.warp(block.timestamp + 1);
    }

    // ── Address reader ──

    function _readAddress(string memory key) internal view returns (address) {
        string memory path = string.concat(vm.projectRoot(), "/chains/8453.json");
        string memory json = vm.readFile(path);
        return vm.parseJsonAddress(json, string.concat(".", key));
    }

    // ── Test syndicate creation ──

    function _createTestSyndicate() internal {
        // Mock the agent registry ownerOf call so owner passes the ERC-8004 check
        vm.mockCall(AGENT_REGISTRY, abi.encodeWithSignature("ownerOf(uint256)", agentNftId), abi.encode(owner));

        // Mock the ENS registrar so register() doesn't revert
        vm.mockCall(ENS_REGISTRAR, abi.encodeWithSignature("register(string,address)"), abi.encode());

        // Also mock available() in case factory checks it
        vm.mockCall(ENS_REGISTRAR, abi.encodeWithSignature("available(string)"), abi.encode(true));

        // Create syndicate via factory as owner
        SyndicateFactory.SyndicateConfig memory config = SyndicateFactory.SyndicateConfig({
            metadataURI: "ipfs://test-integration",
            asset: IERC20(USDC),
            name: "Integration Test Vault",
            symbol: "itUSDC",
            openDeposits: true,
            subdomain: "integration-test"
        });

        vm.prank(owner);
        (, address vaultAddr) = factory.createSyndicate(agentNftId, config);
        vault = SyndicateVault(payable(vaultAddr));

        // Register agent on the vault
        uint256 agentNftId2 = 43;
        vm.mockCall(AGENT_REGISTRY, abi.encodeWithSignature("ownerOf(uint256)", agentNftId2), abi.encode(agent));

        vm.prank(owner);
        vault.registerAgent(agentNftId2, agent);
    }

    // ── Fund LPs and deposit ──

    function _fundAndDeposit(uint256 lp1Amount, uint256 lp2Amount) internal {
        deal(USDC, lp1, lp1Amount);
        deal(USDC, lp2, lp2Amount);

        vm.startPrank(lp1);
        IERC20(USDC).approve(address(vault), lp1Amount);
        vault.deposit(lp1Amount, lp1);
        vm.stopPrank();

        vm.startPrank(lp2);
        IERC20(USDC).approve(address(vault), lp2Amount);
        vault.deposit(lp2Amount, lp2);
        vm.stopPrank();
    }

    // ── Clone and initialize a strategy template ──

    function _cloneAndInit(address template, bytes memory initData) internal returns (address clone) {
        clone = Clones.clone(template);
        // Initialize: vault is the vault, proposer is the agent
        (bool success,) =
            clone.call(abi.encodeWithSignature("initialize(address,address,bytes)", address(vault), agent, initData));
        require(success, "Strategy initialization failed");
    }

    // ── Propose, vote, and execute in one call ──

    function _proposeVoteExecute(
        BatchExecutorLib.Call[] memory execCalls,
        BatchExecutorLib.Call[] memory settleCalls,
        uint256 feeBps,
        uint256 duration
    ) internal returns (uint256 proposalId) {
        // Agent proposes
        vm.prank(agent);
        proposalId = governor.propose(
            address(vault), "ipfs://test", feeBps, duration, execCalls, settleCalls, _emptyCoProposers()
        );

        // Warp 1 second so snapshot timestamp is in the past
        vm.warp(block.timestamp + 1);

        // LPs vote For
        vm.prank(lp1);
        governor.vote(proposalId, ISyndicateGovernor.VoteType.For);
        vm.prank(lp2);
        governor.vote(proposalId, ISyndicateGovernor.VoteType.For);

        // Warp past voting period
        ISyndicateGovernor.GovernorParams memory params = governor.getGovernorParams();
        vm.warp(block.timestamp + params.votingPeriod + 1);

        // Execute
        governor.executeProposal(proposalId);
    }

    // ── Empty co-proposers helper ──

    function _emptyCoProposers() internal pure returns (ISyndicateGovernor.CoProposer[] memory) {
        return new ISyndicateGovernor.CoProposer[](0);
    }
}
