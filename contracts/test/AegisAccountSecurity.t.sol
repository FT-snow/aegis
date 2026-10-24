// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {AegisAccount} from "../src/AegisAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
    function warp(uint256 timestamp) external;
    function expectRevert(bytes calldata revertData) external;
}

contract MockEntryPoint {
    function validate(AegisAccount account, PackedUserOperation calldata userOp, bytes32 userOpHash)
        external
        returns (uint256)
    {
        return account.validateUserOp(userOp, userOpHash, 0);
    }

    function dispatch(AegisAccount account, bytes calldata callData) external returns (bytes memory result) {
        (bool success, bytes memory returnData) = address(account).call(callData);
        if (!success) {
            assembly ("memory-safe") {
                revert(add(returnData, 32), mload(returnData))
            }
        }
        return returnData;
    }
}

contract TestToken {
    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }
}

contract AegisAccountSecurityTest {
    Vm private constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant OWNER_PK = 0xA11CE;
    uint256 private constant SESSION_PK = 0xB0B;
    uint256 private constant CONTROLLER_A_PK = 0xCA11;
    uint256 private constant CONTROLLER_B_PK = 0xCA12;
    uint192 private constant SESSION_NONCE_KEY = 11;
    uint192 private constant CONTROLLER_NONCE_KEY = 77;

    MockEntryPoint private entryPoint;
    TestToken private token;
    AegisAccount private account;
    address private owner;
    address private sessionKey;
    address private recipient;
    bytes32 private passportHash = keccak256("passport");

    function setUp() public {
        vm.warp(1_800_000_000);
        entryPoint = new MockEntryPoint();
        token = new TestToken();
        owner = vm.addr(OWNER_PK);
        sessionKey = vm.addr(SESSION_PK);
        recipient = address(0xBEEF);
        account = new AegisAccount(IEntryPoint(address(entryPoint)), owner, address(token));

        _ownerExecute(abi.encodeCall(
            AegisAccount.addKey,
            (sessionKey, address(token), 0, 0, 1_000, 2_000, 500_000, 1 ether, SESSION_NONCE_KEY, 4, 8)
        ));
        _ownerExecute(abi.encodeCall(AegisAccount.setAllowedTarget, (sessionKey, address(token), bytes4(0xa9059cbb), true)));
        _ownerExecute(abi.encodeCall(AegisAccount.setAllowedRecipient, (sessionKey, recipient, true)));
        _ownerExecute(abi.encodeCall(
            AegisAccount.setRiskController,
            (vm.addr(CONTROLLER_A_PK), CONTROLLER_NONCE_KEY)
        ));
    }

    function testSessionExecutionRechecksOwnerUpdatedValidityWindow() public {
        uint48 newValidAfter = uint48(block.timestamp + 1_000);
        bytes memory updateLimits = abi.encodeCall(
            AegisAccount.updateKeyLimits,
            (sessionKey, newValidAfter, 0, 1_000, 2_000, 500_000, 1 ether, 4, 8)
        );
        PackedUserOperation memory ownerOperation = _ownerOperation(
            abi.encodeCall(AegisAccount.execute, (address(account), 0, updateLimits)),
            keccak256("owner update userop")
        );
        bytes memory transferData = abi.encodeWithSelector(bytes4(0xa9059cbb), recipient, uint256(100));
        PackedUserOperation memory sessionOperation = _sessionOperation(
            abi.encodeCall(
                AegisAccount.executeWithPassport,
                (sessionKey, address(token), 0, transferData, passportHash)
            ),
            keccak256("session transfer userop")
        );

        entryPoint.validate(account, ownerOperation, keccak256("owner update userop"));
        entryPoint.validate(account, sessionOperation, keccak256("session transfer userop"));
        entryPoint.dispatch(account, ownerOperation.callData);

        vm.expectRevert(abi.encodeWithSelector(AegisAccount.KeyNotYetValid.selector, newValidAfter));
        entryPoint.dispatch(account, sessionOperation.callData);
    }

    function testControllerEpochInvalidatesValidatedOperationAcrossAtoBtoARotation() public {
        uint64 oldEpoch = account.riskControllerEpoch();
        bytes memory restrictionCall = abi.encodeCall(
            AegisAccount.tightenRiskRestriction,
            (sessionKey, 500, 1_000, uint48(block.timestamp + 300), false, uint8(75), keccak256("reason"), passportHash, oldEpoch)
        );
        PackedUserOperation memory oldControllerOperation = _controllerOperation(
            restrictionCall,
            keccak256("stale controller userop"),
            vm.addr(CONTROLLER_A_PK),
            CONTROLLER_A_PK,
            oldEpoch
        );
        entryPoint.validate(account, oldControllerOperation, keccak256("stale controller userop"));

        bytes memory rotateToB = abi.encodeCall(
            AegisAccount.setRiskController,
            (vm.addr(CONTROLLER_B_PK), CONTROLLER_NONCE_KEY)
        );
        PackedUserOperation memory rotateToBOperation = _ownerOperation(
            abi.encodeCall(AegisAccount.execute, (address(account), 0, rotateToB)),
            keccak256("rotate to B userop")
        );
        entryPoint.validate(account, rotateToBOperation, keccak256("rotate to B userop"));
        entryPoint.dispatch(account, rotateToBOperation.callData);

        bytes memory rotateBackToA = abi.encodeCall(
            AegisAccount.setRiskController,
            (vm.addr(CONTROLLER_A_PK), CONTROLLER_NONCE_KEY)
        );
        PackedUserOperation memory rotateBackOperation = _ownerOperation(
            abi.encodeCall(AegisAccount.execute, (address(account), 0, rotateBackToA)),
            keccak256("rotate back to A userop")
        );
        entryPoint.validate(account, rotateBackOperation, keccak256("rotate back to A userop"));
        entryPoint.dispatch(account, rotateBackOperation.callData);

        require(account.riskControllerEpoch() > oldEpoch, "controller epoch did not advance");
        vm.expectRevert(abi.encodeWithSelector(AegisAccount.InvalidSignature.selector));
        entryPoint.dispatch(account, oldControllerOperation.callData);
    }

    function _ownerExecute(bytes memory innerCall) private {
        bytes memory callData = abi.encodeCall(AegisAccount.execute, (address(account), 0, innerCall));
        entryPoint.dispatch(account, callData);
    }

    function _ownerOperation(bytes memory callData, bytes32 operationHash)
        private
        returns (PackedUserOperation memory operation)
    {
        operation = _baseOperation(address(account), 0, callData, "");
        operation.signature = _sign(OWNER_PK, operationHash);
    }

    function _sessionOperation(bytes memory callData, bytes32 operationHash)
        private
        returns (PackedUserOperation memory operation)
    {
        operation = _baseOperation(address(account), uint256(SESSION_NONCE_KEY) << 64, callData, "");
        operation.signature = abi.encode(
            sessionKey,
            uint48(block.timestamp / 86_400),
            passportHash,
            _sign(SESSION_PK, operationHash)
        );
    }

    function _controllerOperation(
        bytes memory callData,
        bytes32 operationHash,
        address controller,
        uint256 privateKey,
        uint64 epoch
    ) private returns (PackedUserOperation memory operation) {
        operation = _baseOperation(address(account), uint256(CONTROLLER_NONCE_KEY) << 64, callData, "");
        operation.signature = abi.encode(
            controller,
            uint48(block.timestamp / 86_400),
            passportHash,
            _sign(privateKey, operationHash)
        );
        require(epoch == account.riskControllerEpoch(), "unexpected test epoch");
    }

    function _baseOperation(address sender, uint256 nonce, bytes memory callData, bytes memory signature)
        private
        pure
        returns (PackedUserOperation memory)
    {
        uint256 verificationGas = 150_000;
        uint256 callGas = 150_000;
        return PackedUserOperation({
            sender: sender,
            nonce: nonce,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32((verificationGas << 128) | callGas),
            preVerificationGas: 21_000,
            gasFees: bytes32((uint256(1) << 128) | 1),
            paymasterAndData: "",
            signature: signature
        });
    }

    function _sign(uint256 privateKey, bytes32 digest) private returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
