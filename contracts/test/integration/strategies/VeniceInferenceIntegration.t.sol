// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseIntegrationTest} from "../BaseIntegrationTest.sol";
import {VeniceInferenceStrategy} from "../../../src/strategies/VeniceInferenceStrategy.sol";
import {BatchExecutorLib} from "../../../src/BatchExecutorLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title VeniceInferenceIntegrationTest
 * @notice Fork tests for VeniceInferenceStrategy against real Venice (sVVV) and
 *         Aerodrome on Base mainnet. Validates direct VVV staking, USDC swap path,
 *         and the full execute → settle → claimVVV lifecycle.
 *
 * @dev Run with: forge test --fork-url $BASE_RPC_URL --match-contract VeniceInferenceIntegrationTest
 */
contract VeniceInferenceIntegrationTest is BaseIntegrationTest {
    address veniceTemplate;

    uint256 constant STRATEGY_DURATION = 7 days;
    uint256 constant PERF_FEE_BPS = 1500; // 15%
    uint256 constant VENICE_COOLDOWN = 14 days; // generous cooldown for fork tests

    function setUp() public override {
        super.setUp();
        veniceTemplate = address(new VeniceInferenceStrategy());
    }

    // ==================== HELPERS ====================

    /// @dev Build execution batch calls: [asset.approve(strategy, amount), strategy.execute()]
    function _buildExecCalls(address strategy, address asset, uint256 amount)
        internal
        pure
        returns (BatchExecutorLib.Call[] memory calls)
    {
        calls = new BatchExecutorLib.Call[](2);
        calls[0] =
            BatchExecutorLib.Call({target: asset, data: abi.encodeCall(IERC20.approve, (strategy, amount)), value: 0});
        calls[1] = BatchExecutorLib.Call({target: strategy, data: abi.encodeWithSignature("execute()"), value: 0});
    }

    /// @dev Build settlement batch calls: [strategy.settle()]
    function _buildSettleCalls(address strategy) internal pure returns (BatchExecutorLib.Call[] memory calls) {
        calls = new BatchExecutorLib.Call[](1);
        calls[0] = BatchExecutorLib.Call({target: strategy, data: abi.encodeWithSignature("settle()"), value: 0});
    }

    // ==================== TESTS ====================

    /// @notice Direct VVV path: vault holds VVV, stakes directly, settles, claims back.
    function test_venice_directVVV() public {
        uint256 vvvAmount = 500e18;

        // Give the vault VVV directly
        deal(VVV_TOKEN, address(vault), vvvAmount);

        // Clone and init — direct path (asset == vvv, no swap infra)
        bytes memory initData = abi.encode(
            VeniceInferenceStrategy.InitParams({
                asset: VVV_TOKEN,
                weth: address(0),
                vvv: VVV_TOKEN,
                sVVV: SVVV,
                aeroRouter: address(0),
                aeroFactory: address(0),
                agent: agent,
                assetAmount: vvvAmount,
                minVVV: 0,
                deadlineOffset: 0,
                singleHop: false
            })
        );
        address strategy = _cloneAndInit(veniceTemplate, initData);

        // Agent pre-approves sVVV clawback
        vm.prank(agent);
        IERC20(SVVV).approve(strategy, type(uint256).max);

        // Build batch calls and propose/vote/execute
        BatchExecutorLib.Call[] memory execCalls = _buildExecCalls(strategy, VVV_TOKEN, vvvAmount);
        BatchExecutorLib.Call[] memory settleCalls = _buildSettleCalls(strategy);
        uint256 proposalId = _proposeVoteExecute(execCalls, settleCalls, PERF_FEE_BPS, STRATEGY_DURATION);

        // After execution: agent should hold sVVV
        uint256 agentSVVV = IERC20(SVVV).balanceOf(agent);
        assertGt(agentSVVV, 0, "agent should hold sVVV after execution");

        // Vault VVV should be depleted
        assertEq(IERC20(VVV_TOKEN).balanceOf(address(vault)), 0, "vault VVV should be zero after execution");

        // Warp past strategy duration and settle
        vm.warp(block.timestamp + STRATEGY_DURATION);
        vm.prank(random);
        governor.settleProposal(proposalId);

        // Agent sVVV should be clawed back
        assertEq(IERC20(SVVV).balanceOf(agent), 0, "agent sVVV should be zero after settlement");

        // Warp past Venice unstaking cooldown, then claim
        vm.warp(block.timestamp + VENICE_COOLDOWN);
        VeniceInferenceStrategy(strategy).claimVVV();

        // VVV should be back in the vault
        uint256 vaultVVVAfter = IERC20(VVV_TOKEN).balanceOf(address(vault));
        assertGt(vaultVVVAfter, 0, "vault should hold VVV after claim");
    }

    /// @notice Swap path: vault holds USDC, swaps USDC → WETH → VVV via Aerodrome, stakes, settles, claims.
    function test_venice_swapPath() public {
        uint256 usdcAmount = 500e6;

        // Clone and init — swap path (USDC → WETH → VVV)
        bytes memory initData = abi.encode(
            VeniceInferenceStrategy.InitParams({
                asset: USDC,
                weth: WETH,
                vvv: VVV_TOKEN,
                sVVV: SVVV,
                aeroRouter: AERO_ROUTER,
                aeroFactory: AERO_FACTORY,
                agent: agent,
                assetAmount: usdcAmount,
                minVVV: 1, // minimal slippage check for fork test
                deadlineOffset: 300,
                singleHop: false
            })
        );
        address strategy = _cloneAndInit(veniceTemplate, initData);

        // Agent pre-approves sVVV clawback
        vm.prank(agent);
        IERC20(SVVV).approve(strategy, type(uint256).max);

        uint256 vaultUsdcBefore = IERC20(USDC).balanceOf(address(vault));

        // Build batch calls and propose/vote/execute
        BatchExecutorLib.Call[] memory execCalls = _buildExecCalls(strategy, USDC, usdcAmount);
        BatchExecutorLib.Call[] memory settleCalls = _buildSettleCalls(strategy);
        uint256 proposalId = _proposeVoteExecute(execCalls, settleCalls, PERF_FEE_BPS, STRATEGY_DURATION);

        // After execution: agent should hold sVVV from the swap
        uint256 agentSVVV = IERC20(SVVV).balanceOf(agent);
        assertGt(agentSVVV, 0, "agent should hold sVVV after swap execution");

        // Vault USDC should have decreased
        uint256 vaultUsdcAfter = IERC20(USDC).balanceOf(address(vault));
        assertLt(vaultUsdcAfter, vaultUsdcBefore, "vault USDC should decrease after execution");

        // Warp past strategy duration and settle
        vm.warp(block.timestamp + STRATEGY_DURATION);
        vm.prank(random);
        governor.settleProposal(proposalId);

        // Agent sVVV should be clawed back
        assertEq(IERC20(SVVV).balanceOf(agent), 0, "agent sVVV should be zero after settlement");

        // Warp past Venice unstaking cooldown, then claim
        vm.warp(block.timestamp + VENICE_COOLDOWN);
        VeniceInferenceStrategy(strategy).claimVVV();

        // VVV should be in the vault (strategy returns VVV, not USDC — no reverse swap)
        uint256 vaultVVVAfter = IERC20(VVV_TOKEN).balanceOf(address(vault));
        assertGt(vaultVVVAfter, 0, "vault should hold VVV after claim");
    }

    /// @notice Settle reverts when agent has not pre-approved sVVV clawback.
    function test_venice_noPreApproval_reverts() public {
        uint256 vvvAmount = 500e18;

        // Give the vault VVV directly
        deal(VVV_TOKEN, address(vault), vvvAmount);

        // Clone and init — direct path
        bytes memory initData = abi.encode(
            VeniceInferenceStrategy.InitParams({
                asset: VVV_TOKEN,
                weth: address(0),
                vvv: VVV_TOKEN,
                sVVV: SVVV,
                aeroRouter: address(0),
                aeroFactory: address(0),
                agent: agent,
                assetAmount: vvvAmount,
                minVVV: 0,
                deadlineOffset: 0,
                singleHop: false
            })
        );
        address strategy = _cloneAndInit(veniceTemplate, initData);

        // NOTE: Agent does NOT approve sVVV clawback

        // Build batch calls and propose/vote/execute
        BatchExecutorLib.Call[] memory execCalls = _buildExecCalls(strategy, VVV_TOKEN, vvvAmount);
        BatchExecutorLib.Call[] memory settleCalls = _buildSettleCalls(strategy);
        uint256 proposalId = _proposeVoteExecute(execCalls, settleCalls, PERF_FEE_BPS, STRATEGY_DURATION);

        // Agent holds sVVV but has not approved strategy to pull it back
        assertGt(IERC20(SVVV).balanceOf(agent), 0, "agent should hold sVVV");

        // Warp past strategy duration
        vm.warp(block.timestamp + STRATEGY_DURATION);

        // Settlement should revert because transferFrom(agent → strategy) lacks approval
        vm.prank(random);
        vm.expectRevert();
        governor.settleProposal(proposalId);
    }
}
