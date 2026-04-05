// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {MockWOOD} from "../../src/mocks/MockWOOD.sol";
import {
    IUniswapV3Factory,
    IUniswapV3Pool,
    INonfungiblePositionManager,
    IWETH
} from "../../src/interfaces/IUniswapV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DeployMMTestnet - Deploy MockWOOD + Uniswap V3 pool on Base Sepolia
contract DeployMMTestnet is Script {
    // ── Base Sepolia addresses ──
    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant UNISWAP_V3_FACTORY = 0x4752ba5DBc23f44D87826276BF6Fd6b1C372aD24;
    address constant NFP_MANAGER = 0x27F971cb582BF9E50F397e4d29a5C7A34f11faA2;
    address constant SWAP_ROUTER = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4;

    // ── Config ──
    uint256 constant INITIAL_SUPPLY = 500_000_000e18;
    uint24 constant FEE = 3000;
    int24 constant TICK_SPACING = 60;
    uint256 constant ETH_FOR_LP = 0.002 ether;
    uint256 constant WOOD_FOR_LP = 720e18; // 0.002 ETH * 360,000 WOOD/ETH

    function run() external {
        uint256 deployerPk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        console.log("Deployer:", deployer);

        vm.startBroadcast(deployerPk);

        // 1. Deploy MockWOOD
        MockWOOD wood = new MockWOOD("Wood Token", "WOOD", INITIAL_SUPPLY);
        console.log("MockWOOD:", address(wood));

        // 2. Create and initialize pool
        address pool = _createPool(address(wood));
        console.log("Pool:", pool);

        // 3. Seed liquidity
        uint256 tokenId = _seedLiquidity(address(wood), deployer);
        console.log("LP TokenId:", tokenId);

        vm.stopBroadcast();

        console.log("=== DONE ===");
    }

    function _createPool(address wood) internal returns (address pool) {
        bool woodIsToken0 = wood < WETH;
        address token0 = woodIsToken0 ? wood : WETH;
        address token1 = woodIsToken0 ? WETH : wood;

        console.log("WOOD is token0:", woodIsToken0);

        // sqrtPriceX96 = sqrt(price) * 2^96
        // price = token1 / token0
        // If WOOD < WETH: price = WETH/WOOD = 1/360000, sqrt = 1/600
        //   sqrtPriceX96 = 2^96 / 600 = 132046937523773895989239917227
        // If WETH < WOOD: price = WOOD/WETH = 360000, sqrt = 600
        //   sqrtPriceX96 = 600 * 2^96 = 47536897508558602556126370201600
        uint160 sqrtPrice = woodIsToken0
            ? uint160(132046937523773895989239917227)
            : uint160(47536897508558602556126370201600);

        pool = IUniswapV3Factory(UNISWAP_V3_FACTORY).createPool(token0, token1, FEE);
        IUniswapV3Pool(pool).initialize(sqrtPrice);
    }

    function _seedLiquidity(address wood, address deployer) internal returns (uint256 tokenId) {
        // Wrap ETH
        IWETH(WETH).deposit{value: ETH_FOR_LP}();

        // Approve
        MockWOOD(wood).approve(NFP_MANAGER, WOOD_FOR_LP);
        IWETH(WETH).approve(NFP_MANAGER, ETH_FOR_LP);

        bool woodIsToken0 = wood < WETH;
        int24 tickLower = (-887220 / TICK_SPACING) * TICK_SPACING;
        int24 tickUpper = (887220 / TICK_SPACING) * TICK_SPACING;

        INonfungiblePositionManager.MintParams memory p = INonfungiblePositionManager.MintParams({
            token0: woodIsToken0 ? wood : WETH,
            token1: woodIsToken0 ? WETH : wood,
            fee: FEE,
            tickLower: tickLower,
            tickUpper: tickUpper,
            amount0Desired: woodIsToken0 ? WOOD_FOR_LP : ETH_FOR_LP,
            amount1Desired: woodIsToken0 ? ETH_FOR_LP : WOOD_FOR_LP,
            amount0Min: 0,
            amount1Min: 0,
            recipient: deployer,
            deadline: block.timestamp + 600
        });

        (tokenId,,,) = INonfungiblePositionManager(NFP_MANAGER).mint(p);
    }
}
