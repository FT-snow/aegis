// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {AegisAccount} from "./AegisAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";

/// @notice Deterministic CREATE2 factory. Factory address and constructor args enter account address.
contract AegisAccountFactory {
    IEntryPoint public immutable entryPoint;
    address public immutable defaultToken;

    event AccountCreated(address indexed account, address indexed owner, uint256 indexed salt);

    constructor(IEntryPoint entryPoint_, address defaultToken_) {
        require(address(entryPoint_) != address(0) && defaultToken_ != address(0), "zero address");
        entryPoint = entryPoint_;
        defaultToken = defaultToken_;
    }

    function createAccount(address owner, uint256 salt) external returns (AegisAccount account) {
        address predicted = getAddress(owner, salt);
        if (predicted.code.length != 0) return AegisAccount(payable(predicted));
        bytes32 createSalt = _salt(owner, salt);
        account = new AegisAccount{salt: createSalt}(entryPoint, owner, defaultToken);
        emit AccountCreated(address(account), owner, salt);
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        bytes32 createSalt = _salt(owner, salt);
        bytes32 bytecodeHash = keccak256(
            abi.encodePacked(
                type(AegisAccount).creationCode,
                abi.encode(entryPoint, owner, defaultToken)
            )
        );
        return address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), createSalt, bytecodeHash)))));
    }

    function _salt(address owner, uint256 salt) internal pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }
}
