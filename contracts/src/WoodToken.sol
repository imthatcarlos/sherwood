// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {OFT} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFT.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title WoodToken — LayerZero OFT with hard 1B supply cap
/// @notice Only the Minter contract can mint. Minting gracefully caps at MAX_SUPPLY.
contract WoodToken is OFT {
    uint256 public constant MAX_SUPPLY = 1_000_000_000e18; // 1B tokens

    address public immutable minter;

    error OnlyMinter();

    modifier onlyMinter() {
        if (msg.sender != minter) revert OnlyMinter();
        _;
    }

    /// @param _lzEndpoint LayerZero endpoint on this chain
    /// @param _delegate    LayerZero oApp delegate (usually deployer / multisig)
    /// @param _minter      Address of the Minter contract — sole mint authority
    constructor(address _lzEndpoint, address _delegate, address _minter)
        OFT("Wood Token", "WOOD", _lzEndpoint, _delegate)
        Ownable(_delegate)
    {
        minter = _minter;
    }

    /// @notice Mint `amount` tokens to `to`. If minting the full amount would exceed
    ///         MAX_SUPPLY, only the remaining mintable amount is minted (no revert).
    /// @return minted The actual number of tokens minted (may be less than `amount`).
    function mint(address to, uint256 amount) external onlyMinter returns (uint256 minted) {
        uint256 remaining = totalMintable();
        if (remaining == 0) return 0;

        minted = amount > remaining ? remaining : amount;
        _mint(to, minted);
    }

    /// @notice Returns how many tokens can still be minted before hitting the cap.
    function totalMintable() public view returns (uint256) {
        return MAX_SUPPLY - totalSupply();
    }
}
