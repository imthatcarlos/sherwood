// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Mock Moonwell Comptroller for testing
contract MockComptroller {
    uint256 public mockLiquidity = 100_000e18; // Default: 100k USD borrowing capacity
    uint256 public mockShortfall;
    bool public enterMarketsFail;

    function enterMarkets(address[] calldata) external view returns (uint256[] memory) {
        uint256[] memory results = new uint256[](1);
        results[0] = enterMarketsFail ? 1 : 0;
        return results;
    }

    function getAccountLiquidity(address) external view returns (uint256, uint256, uint256) {
        return (0, mockLiquidity, mockShortfall);
    }

    // Test helpers
    function setLiquidity(uint256 liq) external {
        mockLiquidity = liq;
    }

    function setShortfall(uint256 sf) external {
        mockShortfall = sf;
        mockLiquidity = 0;
    }

    function setEnterMarketsFail(bool fail) external {
        enterMarketsFail = fail;
    }
}
