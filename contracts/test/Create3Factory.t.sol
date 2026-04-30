// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Create3Factory} from "../src/Create3Factory.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @dev Minimal contract used as a deployment payload — has no constructor side-effects
///      so the test can focus on factory access-control behavior.
contract EmptyContract {
    constructor() {}
}

/// @notice Regression coverage for #255 §11 A-C1: `Create3Factory.deploy` must be
///         `onlyOwner` so that mempool observers cannot front-run + squat
///         well-known CREATE3 salts. Mitigation lives at `Create3Factory.sol:17`
///         (`Ownable` + `onlyOwner`); these tests pin the behavior so a future
///         refactor cannot silently regress it.
contract Create3FactoryTest is Test {
    Create3Factory public factory;
    address public owner = makeAddr("owner");
    address public attacker = makeAddr("attacker");

    function setUp() public {
        factory = new Create3Factory(owner);
    }

    /// @notice A-C1: deploy() reverts when called by anyone other than the owner.
    function test_deploy_revertsForNonOwner() public {
        bytes memory creationCode = type(EmptyContract).creationCode;
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        factory.deploy(bytes32(uint256(1)), creationCode);
    }

    /// @notice Sanity: owner can deploy and the resulting contract has runtime code.
    function test_deploy_succeedsForOwner() public {
        bytes memory creationCode = type(EmptyContract).creationCode;
        vm.prank(owner);
        address deployed = factory.deploy(bytes32(uint256(1)), creationCode);
        assertGt(deployed.code.length, 0, "deployed contract has no runtime code");
    }

    /// @notice Address is deterministic from (factory, salt) only — the prediction
    ///         must match the post-deploy address regardless of constructor args.
    function test_addressOf_predictsDeployment() public {
        bytes32 salt = bytes32(uint256(42));
        address predicted = factory.addressOf(salt);
        vm.prank(owner);
        address actual = factory.deploy(salt, type(EmptyContract).creationCode);
        assertEq(predicted, actual, "predicted address differs from deployed address");
    }
}
