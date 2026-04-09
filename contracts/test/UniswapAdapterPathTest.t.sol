// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {UniswapSwapAdapter} from "../src/adapters/UniswapSwapAdapter.sol";

contract UniswapAdapterPathTest is Test {
    UniswapSwapAdapterHarness adapter;

    function setUp() public {
        adapter = new UniswapSwapAdapterHarness(address(1), address(2));
    }

    function test_extractFirstAddress() public view {
        // Path: USDC(20) + fee(3) + WETH(20) + fee(3) + TOKEN(20)
        address usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        address weth = 0x4200000000000000000000000000000000000006;
        address token = 0xf30Bf00edd0C22db54C9274B90D2A4C21FC09b07;
        uint24 fee1 = 500;
        uint24 fee2 = 10000;

        bytes memory path = abi.encodePacked(usdc, fee1, weth, fee2, token);
        assertEq(adapter.extractFirstAddress(path), usdc);
    }

    function test_reversePath_twoHop() public view {
        address usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        address weth = 0x4200000000000000000000000000000000000006;
        address token = 0xf30Bf00edd0C22db54C9274B90D2A4C21FC09b07;
        uint24 fee1 = 500;
        uint24 fee2 = 10000;

        bytes memory forward = abi.encodePacked(usdc, fee1, weth, fee2, token);
        bytes memory reversed = adapter.reversePath(forward);
        bytes memory expected = abi.encodePacked(token, fee2, weth, fee1, usdc);

        assertEq(keccak256(reversed), keccak256(expected), "reversed path should match expected");
        assertEq(adapter.extractFirstAddress(reversed), token, "reversed path starts with token");
    }

    function test_reversePath_singleHop() public view {
        address usdc = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
        address token = 0xf30Bf00edd0C22db54C9274B90D2A4C21FC09b07;
        uint24 fee = 3000;

        bytes memory forward = abi.encodePacked(usdc, fee, token);
        bytes memory reversed = adapter.reversePath(forward);
        bytes memory expected = abi.encodePacked(token, fee, usdc);

        assertEq(keccak256(reversed), keccak256(expected));
    }
}

contract UniswapSwapAdapterHarness is UniswapSwapAdapter {
    constructor(address r, address q) UniswapSwapAdapter(r, q) {}

    function extractFirstAddress(bytes memory path) external pure returns (address) {
        return _extractFirstAddress(path);
    }

    function reversePath(bytes memory path) external pure returns (bytes memory) {
        return _reversePath(path);
    }
}
