// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Create3} from "../src/Create3.sol";

/// @notice External wrapper that exposes the internal library so `vm.expectRevert`
///         catches reverts that bubble out of assembly / inline CREATE2 paths.
contract Create3Wrapper {
    function deploy(bytes32 salt, bytes memory creationCode) external returns (address) {
        return Create3.deploy(salt, creationCode);
    }
}

/// @notice Constructor always reverts — used to drive the failed-CREATE branch
///         inside the trampoline.
contract AlwaysReverts {
    constructor() {
        revert("nope");
    }
}

/// @notice Trivial contract used as a successful deploy payload.
contract NoopContract {
    constructor() {}
}

/// @notice Regression coverage for #255 §11 A-C4: `Create3.deploy` must NOT
///         silently "succeed" when the inner CREATE reverts (the trampoline
///         CREATE2 succeeded but the actual contract never deployed). Mitigation
///         lives at `Create3.sol:37`
///         (`if (!success || deployed.code.length == 0) revert DeployFailed();`).
///         These tests pin the behavior so a future refactor can't silently
///         drop the post-call check and re-introduce the silent-failure bug.
contract Create3Test is Test {
    Create3Wrapper public wrapper;

    function setUp() public {
        wrapper = new Create3Wrapper();
    }

    /// @notice A-C4: when the constructor reverts, `deploy` reverts with
    ///         `DeployFailed` rather than returning the predicted-but-empty
    ///         address.
    function test_deploy_revertsOnConstructorRevert() public {
        bytes memory creationCode = type(AlwaysReverts).creationCode;
        vm.expectRevert(Create3.DeployFailed.selector);
        wrapper.deploy(bytes32(uint256(1)), creationCode);
    }

    /// @notice A-C4 corollary: a second deploy with the same salt reverts.
    ///         The first deploy succeeds and leaves the trampoline at the
    ///         CREATE2 address; the second CREATE2 then collides and the
    ///         library bubbles `TrampolineDeployFailed`. Pinning this prevents
    ///         a future refactor from accidentally allowing salt reuse, which
    ///         would let an attacker (or a careless deploy script) overwrite
    ///         a previously-deployed contract address.
    function test_deploy_revertsOnSaltReuse() public {
        bytes memory creationCode = type(NoopContract).creationCode;
        bytes32 salt = bytes32(uint256(2));

        // First attempt succeeds and persists the trampoline.
        wrapper.deploy(salt, creationCode);

        // Second attempt with the same salt collides on the existing trampoline.
        vm.expectRevert(Create3.TrampolineDeployFailed.selector);
        wrapper.deploy(salt, creationCode);
    }
}
