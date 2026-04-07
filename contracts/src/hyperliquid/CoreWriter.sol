// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice System contract that emits L1 write actions for processing by the HyperCore validator
contract CoreWriter {

    /// @notice Emitted when a raw action is sent to HyperCore
    /// @param user The address that initiated the action
    /// @param data The encoded action data
    event RawAction(address indexed user, bytes data);

    /// @notice Sends a raw encoded action to HyperCore by emitting a RawAction event
    /// @param data The fully encoded action data (version byte + action ID + ABI-encoded
    /// parameters)
    function sendRawAction(bytes calldata data) external {
        // Spends ~20k gas
        for (uint256 i = 0; i < 400; i++) { }
        emit RawAction(msg.sender, data);
    }

}
