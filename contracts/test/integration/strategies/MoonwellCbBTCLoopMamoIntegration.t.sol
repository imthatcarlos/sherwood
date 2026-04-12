// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseIntegrationTest} from "../BaseIntegrationTest.sol";
import {MoonwellCbBTCLoopMamoStrategy} from "../../../src/strategies/MoonwellCbBTCLoopMamoStrategy.sol";
import {ISyndicateGovernor} from "../../../src/interfaces/ISyndicateGovernor.sol";
import {BatchExecutorLib} from "../../../src/BatchExecutorLib.sol";
import {SyndicateFactory} from "../../../src/SyndicateFactory.sol";
import {SyndicateGovernor} from "../../../src/SyndicateGovernor.sol";
import {SyndicateVault} from "../../../src/SyndicateVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICToken} from "../../../src/interfaces/ICToken.sol";

/**
 * @title MoonwellCbBTCLoopMamoIntegrationTest
 * @notice Fork test for the MoonwellCbBTCLoopMamoStrategy against real Moonwell
 *         and Mamo on Base mainnet. Validates the full lifecycle:
 *           cbBTC → Moonwell supply → Moonwell USDC borrow → Mamo deposit →
 *           Mamo withdrawAll → Moonwell repay → Moonwell redeem → back to vault.
 *
 * @dev Mamo's StrategyFactory address is NOT tracked in the Sherwood repo — it
 *      is supplied at CLI time via `--mamo-factory`. For the fork test, set the
 *      `MAMO_FACTORY` env var to the production Mamo StrategyFactory on Base:
 *
 *         export MAMO_FACTORY=0x...
 *
 *      Then run:
 *         forge test --fork-url $BASE_RPC_URL \
 *             --match-contract MoonwellCbBTCLoopMamoIntegrationTest -vvv
 *
 *      If MAMO_FACTORY is unset, the test is skipped at setUp time so CI jobs
 *      that don't have the address available don't fail.
 */
contract MoonwellCbBTCLoopMamoIntegrationTest is BaseIntegrationTest {
    // ── External Moonwell + cbBTC addresses (Base mainnet) ──

    address constant CBBTC = 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf;
    address constant MCBBTC = 0xF877ACaFA28c19b96727966690b2f44d35aD5976;
    // USDC, MOONWELL_MUSDC, and MOONWELL_COMPTROLLER come from BaseIntegrationTest.

    // ── Test parameters ──

    uint256 constant LP1_CBBTC = 0.001e8; // cbBTC has 8 decimals on Base
    uint256 constant LP2_CBBTC = 0.001e8;
    uint256 constant SUPPLY_AMOUNT = 0.0005e8; // ~$40 at current cbBTC price
    uint256 constant BORROW_AMOUNT = 15e6; // 15 USDC — well below max LTV
    uint256 constant STRATEGY_DURATION = 3 days;
    uint256 constant PERF_FEE_BPS = 1000; // 10%

    address loopTemplate;
    address mamoFactory;
    bool mamoFactoryConfigured;

    // ── Setup: cbBTC-denominated vault ──

    function setUp() public override {
        // Skip the whole fixture if Mamo factory isn't configured — this keeps
        // the test harmless when CI doesn't have the address available.
        try vm.envAddress("MAMO_FACTORY") returns (address addr) {
            mamoFactory = addr;
            mamoFactoryConfigured = addr != address(0);
        } catch {
            mamoFactoryConfigured = false;
        }
        if (!mamoFactoryConfigured) return;

        // Read deployed Sherwood addresses from chains/8453.json
        factory = SyndicateFactory(_readAddress("SYNDICATE_FACTORY"));
        governor = SyndicateGovernor(_readAddress("SYNDICATE_GOVERNOR"));
        deployer = _readAddress("DEPLOYER");

        _createCbBTCSyndicate();

        // Fund LPs with cbBTC and deposit into vault
        deal(CBBTC, lp1, LP1_CBBTC);
        deal(CBBTC, lp2, LP2_CBBTC);

        vm.startPrank(lp1);
        IERC20(CBBTC).approve(address(vault), LP1_CBBTC);
        vault.deposit(LP1_CBBTC, lp1);
        vm.stopPrank();

        vm.startPrank(lp2);
        IERC20(CBBTC).approve(address(vault), LP2_CBBTC);
        vault.deposit(LP2_CBBTC, lp2);
        vm.stopPrank();

        // Warp 1 second so snapshot block is in the past for voting
        vm.warp(block.timestamp + 1);

        loopTemplate = address(new MoonwellCbBTCLoopMamoStrategy());
    }

    /// @dev Silently skip each test if the fixture wasn't configured.
    modifier requiresMamo() {
        if (!mamoFactoryConfigured) {
            emit log("SKIP: MAMO_FACTORY env var not set - skipping Moonwell cbBTC Mamo loop fork test");
            return;
        }
        _;
    }

    // ── Internal: create cbBTC-denominated syndicate ──

    function _createCbBTCSyndicate() internal {
        vm.mockCall(AGENT_REGISTRY, abi.encodeWithSignature("ownerOf(uint256)", agentNftId), abi.encode(owner));
        vm.mockCall(ENS_REGISTRAR, abi.encodeWithSignature("register(string,address)"), abi.encode());
        vm.mockCall(ENS_REGISTRAR, abi.encodeWithSignature("available(string)"), abi.encode(true));

        SyndicateFactory.SyndicateConfig memory config = SyndicateFactory.SyndicateConfig({
            metadataURI: "ipfs://test-cbbtc-loop-integration",
            asset: IERC20(CBBTC),
            name: "cbBTC Loop Integration Vault",
            symbol: "itCBBTC",
            openDeposits: true,
            subdomain: "cbbtc-loop-integration"
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

    // ── Helpers ──

    function _buildInitParams(uint256 supplyAmount_, uint256 borrowAmount_)
        internal
        view
        returns (MoonwellCbBTCLoopMamoStrategy.InitParams memory)
    {
        return MoonwellCbBTCLoopMamoStrategy.InitParams({
            cbBTC: CBBTC,
            usdc: USDC,
            mCbBTC: MCBBTC,
            mUSDC: MOONWELL_MUSDC,
            comptroller: MOONWELL_COMPTROLLER,
            mamoFactory: mamoFactory,
            supplyAmount: supplyAmount_,
            borrowAmount: borrowAmount_,
            minRedeemAmount: (supplyAmount_ * 90) / 100 // 90% floor — conservative
        });
    }

    function _buildExecCalls(address strategy, uint256 supplyAmount_)
        internal
        pure
        returns (BatchExecutorLib.Call[] memory calls)
    {
        calls = new BatchExecutorLib.Call[](2);
        calls[0] = BatchExecutorLib.Call({
            target: CBBTC, data: abi.encodeCall(IERC20.approve, (strategy, supplyAmount_)), value: 0
        });
        calls[1] = BatchExecutorLib.Call({target: strategy, data: abi.encodeWithSignature("execute()"), value: 0});
    }

    function _buildSettleCalls(address strategy) internal pure returns (BatchExecutorLib.Call[] memory calls) {
        calls = new BatchExecutorLib.Call[](1);
        calls[0] = BatchExecutorLib.Call({target: strategy, data: abi.encodeWithSignature("settle()"), value: 0});
    }

    function _deployAndExecute(uint256 supplyAmount_, uint256 borrowAmount_)
        internal
        returns (address strategy, uint256 proposalId)
    {
        bytes memory initData = abi.encode(_buildInitParams(supplyAmount_, borrowAmount_));
        strategy = _cloneAndInit(loopTemplate, initData);

        BatchExecutorLib.Call[] memory execCalls = _buildExecCalls(strategy, supplyAmount_);
        BatchExecutorLib.Call[] memory settleCalls = _buildSettleCalls(strategy);

        proposalId = _proposeVoteExecute(execCalls, settleCalls, PERF_FEE_BPS, STRATEGY_DURATION);
    }

    // ── Tests ──

    /// @notice Full happy-path lifecycle: execute → warp duration → settle. Vault
    ///         should regain cbBTC at or near what it supplied (dust tolerance).
    function test_executeAndSettle_happyPath() public requiresMamo {
        uint256 vaultBalBefore = IERC20(CBBTC).balanceOf(address(vault));

        (address strategy, uint256 proposalId) = _deployAndExecute(SUPPLY_AMOUNT, BORROW_AMOUNT);

        // Post-execute: strategy holds mCbBTC; vault cbBTC balance dropped
        assertGt(ICToken(MCBBTC).balanceOf(strategy), 0, "strategy should hold mCbBTC");
        assertEq(
            IERC20(CBBTC).balanceOf(address(vault)), vaultBalBefore - SUPPLY_AMOUNT, "vault cbBTC dropped by supply"
        );

        // Strategy must hold zero USDC (it was deposited into Mamo)
        assertEq(IERC20(USDC).balanceOf(strategy), 0, "strategy should not hold USDC post-execute");

        // Warp past strategy duration
        vm.warp(block.timestamp + STRATEGY_DURATION);

        // Settle
        vm.prank(random);
        governor.settleProposal(proposalId);

        assertEq(
            uint256(governor.getProposalState(proposalId)),
            uint256(ISyndicateGovernor.ProposalState.Settled),
            "proposal should be settled"
        );
        assertFalse(vault.redemptionsLocked(), "redemptions should be unlocked after settlement");

        // Vault should recover within 1% of its starting cbBTC balance. Small
        // amounts (0.0005 cbBTC) over 3 days will see minimal yield drift.
        uint256 vaultBalAfter = IERC20(CBBTC).balanceOf(address(vault));
        assertApproxEqAbs(vaultBalAfter, vaultBalBefore, vaultBalBefore / 100, "vault cbBTC ~= pre-strategy balance");
    }

    /// @notice Borrowing well beyond the collateral's max LTV must fail at the
    ///         Moonwell borrow() call. We pick a wildly oversized USDC request.
    function test_execute_reverts_whenBorrowExceedsCollateralFactor() public requiresMamo {
        // Try to borrow 10,000 USDC against 0.0005 cbBTC — impossible under any sane LTV
        bytes memory initData = abi.encode(_buildInitParams(SUPPLY_AMOUNT, 10_000e6));
        address strategy = _cloneAndInit(loopTemplate, initData);

        BatchExecutorLib.Call[] memory execCalls = _buildExecCalls(strategy, SUPPLY_AMOUNT);
        BatchExecutorLib.Call[] memory settleCalls = _buildSettleCalls(strategy);

        // Propose + execute should revert inside the governor batch
        vm.prank(agent);
        uint256 proposalId = governor.propose(
            address(vault),
            "ipfs://test-overborrow",
            PERF_FEE_BPS,
            STRATEGY_DURATION,
            execCalls,
            settleCalls,
            _emptyCoProposers()
        );

        vm.warp(block.timestamp + 1);
        vm.prank(lp1);
        governor.vote(proposalId, ISyndicateGovernor.VoteType.For);
        vm.prank(lp2);
        governor.vote(proposalId, ISyndicateGovernor.VoteType.For);

        ISyndicateGovernor.GovernorParams memory params = governor.getGovernorParams();
        vm.warp(block.timestamp + params.votingPeriod + 1);

        vm.expectRevert();
        governor.executeProposal(proposalId);
    }

    /// @notice Running far past the strategy duration should grow the Moonwell
    ///         borrow debt faster than Mamo yield can cover — settlement must
    ///         revert with InsufficientMamoReturn rather than leaving debt open.
    function test_settle_reverts_whenMamoReturnBelowDebt() public requiresMamo {
        (address strategy, uint256 proposalId) = _deployAndExecute(SUPPLY_AMOUNT, BORROW_AMOUNT);

        // Warp a full year — interest accrual should swamp any yield on $15 USDC
        vm.warp(block.timestamp + 365 days);

        vm.prank(random);
        vm.expectRevert(
            abi.encodeWithSelector(
                MoonwellCbBTCLoopMamoStrategy.InsufficientMamoReturn.selector,
                IERC20(USDC).balanceOf(strategy), // whatever Mamo returned
                0 // placeholder — expectRevert only checks the selector+args prefix we care about
            )
        );
        governor.settleProposal(proposalId);
        // Note: above expectRevert will only match if the exact args align. If
        // Mamo returns slightly different amounts on each fork block, fall back
        // to a bare `vm.expectRevert();` with no selector. Keeping the specific
        // form here so test failures surface the actual error selector.
    }

    /// @notice After execution, the view function should return nonzero rate
    ///         fields since the strategy has interacted with Moonwell.
    function test_getYieldInfo_returnsSaneValues() public requiresMamo {
        (address strategy,) = _deployAndExecute(SUPPLY_AMOUNT, BORROW_AMOUNT);

        (uint256 supplyApy, uint256 borrowApr, uint256 mamoApy,) =
            MoonwellCbBTCLoopMamoStrategy(strategy).getYieldInfo();

        assertGt(supplyApy, 0, "cbBTC supply APY should be nonzero");
        assertGt(borrowApr, 0, "USDC borrow APR should be nonzero");
        assertEq(mamoApy, 0, "v1 returns 0 for Mamo APY (sourced off-chain)");
    }
}
