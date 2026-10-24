// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import {BaseAccount} from "@account-abstraction/contracts/core/BaseAccount.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";

/// @title AegisAccount
/// @notice ERC-4337 v0.7 account that enforces session-key spend policy in validation.
/// @dev Session EIP-1271 authorizations only work after a policy-checked UserOp has
///      reserved budget. This lets x402 EIP-3009 work without giving agent keys a
///      policy-free token signature path.
contract AegisAccount is BaseAccount {
    uint256 private constant DAY_SECONDS = 86_400;
    uint256 private constant MAX_APPROVAL_DATA_BYTES = 2_048;
    uint256 private constant MAX_REASON_BYTES = 512;
    bytes4 private constant ERC20_TRANSFER = 0xa9059cbb;
    bytes4 private constant EIP3009_TRANSFER_WITH_AUTHORIZATION = 0xe3ee160e;
    bytes32 private constant EIP3009_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );
    bytes4 private constant EIP1271_MAGIC_VALUE = 0x1626ba7e;
    bytes4 private constant EIP1271_INVALID_VALUE = 0xffffffff;

    error NotSelf();
    error NotEntryPoint();
    error ZeroAddress();
    error UnsupportedChain(uint256 chainId);
    error InvalidSignature();
    error KeyNotActive(address key);
    error KeyValidityInvalid();
    error KeyNotYetValid(uint48 validAfter);
    error KeyExpired(uint48 validUntil);
    error Paused();
    error UnsupportedSessionCall(bytes4 selector);
    error PassportHashMismatch();
    error TargetNotAllowed(address target);
    error SelectorNotAllowed(address target, bytes4 selector);
    error RecipientNotAllowed(address recipient);
    error InvalidTransferShape();
    error PerTxLimitExceeded(uint256 amount, uint256 limit);
    error DailyLimitExceeded(uint256 spent, uint256 amount, uint256 limit);
    error GasLimitExceeded(uint256 gasUnits, uint256 limit);
    error DailyGasCapExceeded(uint256 reserved, uint256 amount, uint256 limit);
    error WrongDayBucket(uint48 provided, uint48 expected);
    error ApprovalQueueFull(address key);
    error ApprovalRequestBudgetExceeded(address key, uint48 dayBucket);
    error ApprovalNotPending(uint256 requestId);
    error ApprovalExpired(uint256 requestId);
    error ApprovalDataTooLarge();
    error ReasonTooLarge();
    error InvalidX402Authorization();
    error RiskControllerNotConfigured();
    error RiskRestrictionNotTightening();
    error SessionKeySuspended(address key);
    error X402AuthorizationAlreadyExists(bytes32 digest);
    error CallFailed(address target, bytes reason);

    event KeyAdded(address indexed key, uint48 validAfter, uint48 validUntil, uint256 nonceKey);
    event KeyUpdated(address indexed key);
    event KeyRevoked(address indexed key);
    event PolicyUpdated(address indexed key, address indexed target, bytes4 selector, bool allowed);
    event RecipientUpdated(address indexed key, address indexed recipient, bool allowed);
    event PausedStateChanged(bool paused);
    event ApprovalRequested(
        uint256 indexed requestId,
        address indexed key,
        address indexed target,
        uint256 value,
        bytes4 selector,
        string reason,
        uint48 expiresAt,
        bytes32 passportHash
    );
    event ApprovalApproved(uint256 indexed requestId, bytes32 passportHash);
    event ApprovalDenied(uint256 indexed requestId);
    event ApprovalExpiredEvent(uint256 indexed requestId);
    event CallExecuted(
        address indexed key,
        address indexed target,
        address indexed recipient,
        uint256 amount,
        bytes4 selector,
        bytes32 passportHash
    );
    event X402AuthorizationEnabled(
        address indexed key,
        bytes32 indexed authorizationDigest,
        address indexed token,
        address recipient,
        uint256 amount,
        uint48 validAfter,
        uint48 validBefore,
        bytes32 passportHash
    );
    event X402AuthorizationRevoked(bytes32 indexed authorizationDigest);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event RiskControllerUpdated(address indexed previousController, address indexed newController, uint192 nonceKey, uint64 epoch);
    event RiskRestrictionApplied(
        address indexed key,
        uint8 riskScore,
        bytes32 reasonHash,
        bytes32 passportHash
    );
    event RiskRestrictionCleared(address indexed key, address indexed owner, bytes32 recoveryReasonHash);

    struct SessionKey {
        bool active;
        uint48 validAfter;
        uint48 validUntil;
        uint256 perTxLimit;
        uint256 dailyLimit;
        uint256 maxGasPerOp;
        uint256 dailyGasCapWei;
        uint192 nonceKey;
        uint32 maxPending;
        uint32 maxRequestsPerDay;
        address token;
    }

    enum ApprovalStatus {
        None,
        Pending,
        Approved,
        Denied,
        Expired
    }

    struct PendingApproval {
        address key;
        address target;
        address recipient;
        uint256 value;
        bytes data;
        bytes4 selector;
        bytes32 passportHash;
        uint48 createdAt;
        uint48 expiresAt;
        ApprovalStatus status;
    }

    struct X402Authorization {
        address key;
        address token;
        address recipient;
        uint256 amount;
        uint48 validAfter;
        uint48 validBefore;
        uint48 dayBucket;
        bool active;
    }

    struct RiskRestriction {
        uint256 perTxLimit;
        uint256 dailyLimit;
        uint48 suspendedUntil;
        bool frozen;
        uint8 latestRiskScore;
        bytes32 lastReasonHash;
        bytes32 lastPassportHash;
    }

    IEntryPoint private immutable _entryPoint;
    address public immutable policyToken;
    address public owner;
    address public riskController;
    uint192 public riskControllerNonceKey;
    uint64 public riskControllerEpoch;
    bool public paused;
    uint256 public nextApprovalId = 1;

    mapping(address key => SessionKey config) public sessionKeys;
    mapping(address key => mapping(address target => mapping(bytes4 selector => bool allowed))) public allowedCalls;
    mapping(address key => mapping(address recipient => bool allowed)) public allowedRecipients;
    mapping(address key => mapping(uint48 dayBucket => uint256 amount)) public spentByBucket;
    mapping(address key => mapping(uint48 dayBucket => uint256 amountWei)) public gasByBucket;
    mapping(address key => mapping(uint48 dayBucket => uint32 count)) public approvalRequestsByBucket;
    mapping(address key => uint32 count) public pendingCount;
    mapping(uint256 requestId => PendingApproval approval) private _pending;
    mapping(bytes32 digest => X402Authorization authorization) private _x402Authorizations;
    mapping(address key => RiskRestriction restriction) public riskRestrictions;

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    modifier onlyEntryPoint() {
        if (msg.sender != address(_entryPoint)) revert NotEntryPoint();
        _;
    }

    constructor(IEntryPoint entryPoint_, address owner_, address token_) {
        if (address(entryPoint_) == address(0) || owner_ == address(0) || token_ == address(0)) {
            revert ZeroAddress();
        }
        _entryPoint = entryPoint_;
        policyToken = token_;
        owner = owner_;
        emit OwnershipTransferred(address(0), owner_);
    }

    function entryPoint() public view override returns (IEntryPoint) {
        return _entryPoint;
    }

    /// @notice Owner's unrestricted execution entrypoint; owner must sign the UserOp.
    function execute(address target, uint256 value, bytes calldata data) external onlyEntryPoint {
        _call(target, value, data);
        emit CallExecuted(owner, target, address(0), value, _selectorCalldata(data), bytes32(0));
    }

    struct AegisCall {
        address target;
        uint256 value;
        bytes data;
    }

    /// @notice Owner-only batch execution; session keys remain limited to single policy-shaped calls.
    function executeBatch(AegisCall[] calldata calls) external onlyEntryPoint {
        for (uint256 index; index < calls.length; ++index) {
            _call(calls[index].target, calls[index].value, calls[index].data);
            emit CallExecuted(
                owner,
                calls[index].target,
                address(0),
                calls[index].value,
                _selectorCalldata(calls[index].data),
                bytes32(0)
            );
        }
    }

    /// @notice Policy-limited transfer entrypoint used by session keys.
    function executeWithPassport(
        address key,
        address target,
        uint256 value,
        bytes calldata data,
        bytes32 passportHash
    ) external onlyEntryPoint {
        if (key == address(0) || key == owner) revert KeyNotActive(key);
        SessionKey storage config = sessionKeys[key];
        if (!config.active || paused) revert KeyNotActive(key);
        _requireSessionNotRestricted(key);
        _requireSessionKeyValid(key, config);
        if (value != 0 || data.length != 68 || _selectorCalldata(data) != ERC20_TRANSFER) revert InvalidTransferShape();
        (address recipient, uint256 amount) = abi.decode(data[4:], (address, uint256));
        amount = _validateTransfer(key, config, target, value, data);
        uint48 bucket = uint48(block.timestamp / DAY_SECONDS);
        uint256 dailyLimit = _effectiveDailyLimit(key, config);
        if (spentByBucket[key][bucket] > dailyLimit) {
            revert DailyLimitExceeded(spentByBucket[key][bucket], 0, dailyLimit);
        }
        bytes memory transferResult = _call(target, value, data);
        if (transferResult.length != 32 || !abi.decode(transferResult, (bool))) revert InvalidTransferShape();
        emit CallExecuted(key, target, recipient, amount, ERC20_TRANSFER, passportHash);
    }

    /// @notice Bounded exception request. Call itself cannot execute stored action.
    function requestApproval(
        address key,
        address target,
        uint256 value,
        bytes calldata data,
        string calldata reason,
        bytes32 passportHash
    ) external onlyEntryPoint returns (uint256 requestId) {
        if (data.length > MAX_APPROVAL_DATA_BYTES) revert ApprovalDataTooLarge();
        if (bytes(reason).length > MAX_REASON_BYTES) revert ReasonTooLarge();
        if (target == address(0)) revert ZeroAddress();
        SessionKey storage config = sessionKeys[key];
        if (key == address(0) || key == owner || !config.active || paused) revert KeyNotActive(key);
        _requireSessionNotRestricted(key);
        _requireSessionKeyValid(key, config);
        uint48 dayBucket = uint48(block.timestamp / DAY_SECONDS);
        if (pendingCount[key] >= config.maxPending) revert ApprovalQueueFull(key);
        if (approvalRequestsByBucket[key][dayBucket] >= config.maxRequestsPerDay) {
            revert ApprovalRequestBudgetExceeded(key, dayBucket);
        }
        pendingCount[key] += 1;
        approvalRequestsByBucket[key][dayBucket] += 1;
        bytes4 selector = _selectorCalldata(data);
        (address recipient, uint256 amount) = _tryDecodeTransfer(data);
        requestId = nextApprovalId++;
        uint48 expiresAt = uint48(block.timestamp + 1 days);
        _pending[requestId] = PendingApproval({
            key: key,
            target: target,
            recipient: recipient,
            value: value,
            data: data,
            selector: selector,
            passportHash: passportHash,
            createdAt: uint48(block.timestamp),
            expiresAt: expiresAt,
            status: ApprovalStatus.Pending
        });
        emit ApprovalRequested(requestId, key, target, value, selector, reason, expiresAt, passportHash);
    }

    /// @notice Pre-authorizes one EIP-3009 payment under session policy for x402.
    /// @dev Session key first submits this as ERC-4337 UserOp; resource-server facilitator
    ///      later calls the token, which queries isValidSignature on this account.
    function authorizeX402(
        address key,
        bytes32 digest,
        address token,
        address recipient,
        uint256 amount,
        uint48 validAfter,
        uint48 validBefore,
        bytes32 nonce,
        bytes32 passportHash
    ) external onlyEntryPoint {
        nonce; // Bound into digest by EIP-3009; retained as explicit event/audit input.
        if (_x402Authorizations[digest].active) revert X402AuthorizationAlreadyExists(digest);
        SessionKey storage config = sessionKeys[key];
        if (!config.active || paused) revert KeyNotActive(key);
        _requireSessionNotRestricted(key);
        _requireSessionKeyValid(key, config);
        if (
            token != config.token || token != policyToken ||
            !allowedCalls[key][token][EIP3009_TRANSFER_WITH_AUTHORIZATION]
        ) {
            revert TargetNotAllowed(token);
        }
        if (!allowedRecipients[key][recipient]) revert RecipientNotAllowed(recipient);
        uint256 effectiveLimit = _effectivePerTxLimit(key, config);
        if (amount == 0 || amount > effectiveLimit) revert PerTxLimitExceeded(amount, effectiveLimit);
        uint48 bucket = uint48(block.timestamp / DAY_SECONDS);
        uint256 effectiveDailyLimit = _effectiveDailyLimit(key, config);
        if (spentByBucket[key][bucket] > effectiveDailyLimit) {
            revert DailyLimitExceeded(spentByBucket[key][bucket], 0, effectiveDailyLimit);
        }
        if (validBefore <= validAfter) revert InvalidX402Authorization();
        (bool domainSuccess, bytes memory domainData) = token.staticcall(abi.encodeWithSignature("DOMAIN_SEPARATOR()"));
        if (!domainSuccess || domainData.length != 32) revert InvalidX402Authorization();
        bytes32 domainSeparator = abi.decode(domainData, (bytes32));
        bytes32 structHash = keccak256(
            abi.encode(EIP3009_TYPEHASH, address(this), recipient, amount, validAfter, validBefore, nonce)
        );
        bytes32 expectedDigest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        if (expectedDigest != digest) revert InvalidX402Authorization();
        _x402Authorizations[digest] = X402Authorization({
            key: key,
            token: token,
            recipient: recipient,
            amount: amount,
            validAfter: validAfter,
            validBefore: validBefore,
            dayBucket: uint48(block.timestamp / DAY_SECONDS),
            active: true
        });
        emit X402AuthorizationEnabled(key, digest, token, recipient, amount, validAfter, validBefore, passportHash);
    }

    /// @notice Standard ERC-1271 validation. Session signatures only pass for pre-authorized x402 digests.
    function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
        if (_recoverCalldata(digest, signature) == owner) return EIP1271_MAGIC_VALUE;
        X402Authorization storage authorization = _x402Authorizations[digest];
        if (
            !paused &&
            authorization.active &&
            msg.sender == authorization.token &&
            block.timestamp / DAY_SECONDS == authorization.dayBucket &&
            block.timestamp >= authorization.validAfter &&
            block.timestamp <= authorization.validBefore &&
            _sessionAuthorizationActive(authorization.key) &&
            _recoverCalldata(digest, signature) == authorization.key
        ) return EIP1271_MAGIC_VALUE;
        return EIP1271_INVALID_VALUE;
    }

    function getApproval(uint256 requestId) external view returns (PendingApproval memory) {
        return _pending[requestId];
    }

    function getX402Authorization(bytes32 digest) external view returns (X402Authorization memory) {
        return _x402Authorizations[digest];
    }

    function getEffectiveLimits(address key)
        external
        view
        returns (uint256 perTxLimit, uint256 dailyLimit, bool frozen, uint48 suspendedUntil)
    {
        SessionKey storage config = sessionKeys[key];
        RiskRestriction storage restriction = riskRestrictions[key];
        perTxLimit = restriction.perTxLimit == 0 || restriction.perTxLimit > config.perTxLimit
            ? config.perTxLimit
            : restriction.perTxLimit;
        dailyLimit = restriction.dailyLimit == 0 || restriction.dailyLimit > config.dailyLimit
            ? config.dailyLimit
            : restriction.dailyLimit;
        frozen = restriction.frozen;
        suspendedUntil = restriction.suspendedUntil;
    }

    // All administrative controls are invoked by an owner-signed UserOp calling `execute(address(this), ...)`.

    function addKey(
        address key,
        address token,
        uint48 validAfter,
        uint48 validUntil,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint256 maxGasPerOp,
        uint256 dailyGasCapWei,
        uint192 nonceKey,
        uint32 maxPending,
        uint32 maxRequestsPerDay
    ) external onlySelf {
        if (key == address(0) || key == owner || key == riskController || token == address(0)) revert ZeroAddress();
        if (token != policyToken) revert TargetNotAllowed(token);
        if (validUntil != 0 && validUntil < validAfter) revert KeyValidityInvalid();
        if (maxPending == 0 || maxRequestsPerDay == 0 || perTxLimit == 0 || dailyLimit < perTxLimit) {
            revert KeyValidityInvalid();
        }
        sessionKeys[key] = SessionKey({
            active: true,
            validAfter: validAfter,
            validUntil: validUntil,
            perTxLimit: perTxLimit,
            dailyLimit: dailyLimit,
            maxGasPerOp: maxGasPerOp,
            dailyGasCapWei: dailyGasCapWei,
            nonceKey: nonceKey,
            maxPending: maxPending,
            maxRequestsPerDay: maxRequestsPerDay,
            token: token
        });
        emit KeyAdded(key, validAfter, validUntil, nonceKey);
    }

    function updateKeyLimits(
        address key,
        uint48 validAfter,
        uint48 validUntil,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint256 maxGasPerOp,
        uint256 dailyGasCapWei,
        uint32 maxPending,
        uint32 maxRequestsPerDay
    ) external onlySelf {
        SessionKey storage config = sessionKeys[key];
        if (!config.active) revert KeyNotActive(key);
        if (validUntil != 0 && validUntil < validAfter) revert KeyValidityInvalid();
        if (perTxLimit == 0 || dailyLimit < perTxLimit || maxPending == 0 || maxRequestsPerDay == 0) {
            revert KeyValidityInvalid();
        }
        config.validAfter = validAfter;
        config.validUntil = validUntil;
        config.perTxLimit = perTxLimit;
        config.dailyLimit = dailyLimit;
        config.maxGasPerOp = maxGasPerOp;
        config.dailyGasCapWei = dailyGasCapWei;
        config.maxPending = maxPending;
        config.maxRequestsPerDay = maxRequestsPerDay;
        emit KeyUpdated(key);
    }

    function setAllowedTarget(address key, address target, bytes4 selector, bool allowed) external onlySelf {
        allowedCalls[key][target][selector] = allowed;
        emit PolicyUpdated(key, target, selector, allowed);
    }

    function setAllowedRecipient(address key, address recipient, bool allowed) external onlySelf {
        allowedRecipients[key][recipient] = allowed;
        emit RecipientUpdated(key, recipient, allowed);
    }

    function revokeKey(address key) external onlySelf {
        if (!sessionKeys[key].active) revert KeyNotActive(key);
        sessionKeys[key].active = false;
        emit KeyRevoked(key);
    }

    function pause() external onlySelf {
        paused = true;
        emit PausedStateChanged(true);
    }

    function unpause() external onlySelf {
        paused = false;
        emit PausedStateChanged(false);
    }

    function transferOwnership(address newOwner) external onlySelf {
        if (newOwner == address(0) || newOwner == riskController) revert ZeroAddress();
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    /// @notice Set the isolated risk-signing identity. Relaxation remains owner-only.
    function setRiskController(address controller, uint192 nonceKey) external onlySelf {
        if (controller == owner || (controller != address(0) && sessionKeys[controller].active)) revert ZeroAddress();
        address previous = riskController;
        if (controller != previous || nonceKey != riskControllerNonceKey) {
            if (riskControllerEpoch == type(uint64).max) revert RiskRestrictionNotTightening();
            riskControllerEpoch += 1;
        }
        riskController = controller;
        riskControllerNonceKey = nonceKey;
        emit RiskControllerUpdated(previous, controller, nonceKey, riskControllerEpoch);
    }

    /// @notice Owner-only recovery path; callers must wrap this in an owner-signed UserOp.
    function clearRiskRestriction(address key, bytes32 recoveryReasonHash) external onlySelf {
        if (!sessionKeys[key].active) revert KeyNotActive(key);
        delete riskRestrictions[key];
        emit RiskRestrictionCleared(key, owner, recoveryReasonHash);
    }

    /// @notice Controller-only, monotonic reduction of effective key permissions.
    function tightenRiskRestriction(
        address key,
        uint256 perTxLimit,
        uint256 dailyLimit,
        uint48 suspendedUntil,
        bool freezeAgent,
        uint8 riskScore,
        bytes32 reasonHash,
        bytes32 passportHash,
        uint64 controllerEpoch
    ) external onlyEntryPoint {
        if (riskController == address(0)) revert RiskControllerNotConfigured();
        if (controllerEpoch != riskControllerEpoch) revert InvalidSignature();
        if (riskScore < 60 || riskScore > 100 || perTxLimit == 0 || dailyLimit == 0) {
            revert RiskRestrictionNotTightening();
        }
        if (freezeAgent && riskScore < 80) revert RiskRestrictionNotTightening();
        SessionKey storage config = sessionKeys[key];
        if (!config.active || key == owner) revert KeyNotActive(key);
        RiskRestriction storage restriction = riskRestrictions[key];
        uint256 oldPerTx = restriction.perTxLimit == 0 ? config.perTxLimit : restriction.perTxLimit;
        uint256 oldDaily = restriction.dailyLimit == 0 ? config.dailyLimit : restriction.dailyLimit;
        uint48 oldSuspendedUntil = restriction.suspendedUntil;
        if (
            perTxLimit > config.perTxLimit || perTxLimit > oldPerTx ||
            dailyLimit > config.dailyLimit || dailyLimit > oldDaily ||
            suspendedUntil < oldSuspendedUntil ||
            (restriction.frozen && !freezeAgent)
        ) revert RiskRestrictionNotTightening();

        restriction.perTxLimit = perTxLimit;
        restriction.dailyLimit = dailyLimit;
        restriction.suspendedUntil = suspendedUntil;
        restriction.frozen = restriction.frozen || freezeAgent;
        restriction.latestRiskScore = riskScore;
        restriction.lastReasonHash = reasonHash;
        restriction.lastPassportHash = passportHash;
        emit RiskRestrictionApplied(key, riskScore, reasonHash, passportHash);
    }

    function approve(uint256 requestId) external onlySelf {
        _approve(requestId);
    }

    function approveAndAllow(uint256 requestId, address recipient) external onlySelf {
        PendingApproval storage approval = _pending[requestId];
        if (approval.status != ApprovalStatus.Pending) revert ApprovalNotPending(requestId);
        if (approval.expiresAt < block.timestamp) revert ApprovalExpired(requestId);
        allowedCalls[approval.key][approval.target][approval.selector] = true;
        if (recipient != address(0)) allowedRecipients[approval.key][recipient] = true;
        emit PolicyUpdated(approval.key, approval.target, approval.selector, true);
        if (recipient != address(0)) emit RecipientUpdated(approval.key, recipient, true);
        _approve(requestId);
    }

    function deny(uint256 requestId) external onlySelf {
        PendingApproval storage approval = _pending[requestId];
        if (approval.status != ApprovalStatus.Pending) revert ApprovalNotPending(requestId);
        approval.status = ApprovalStatus.Denied;
        if (approval.key != owner) pendingCount[approval.key] -= 1;
        emit ApprovalDenied(requestId);
    }

    /// @notice Release a queue slot for an expired owner-approval request.
    function expireApproval(uint256 requestId) external {
        PendingApproval storage approval = _pending[requestId];
        if (approval.status != ApprovalStatus.Pending) revert ApprovalNotPending(requestId);
        if (approval.expiresAt >= block.timestamp) revert ApprovalExpired(requestId);
        approval.status = ApprovalStatus.Expired;
        if (approval.key != owner) pendingCount[approval.key] -= 1;
        emit ApprovalExpiredEvent(requestId);
    }

    function revokeX402Authorization(bytes32 digest) external onlySelf {
        X402Authorization storage authorization = _x402Authorizations[digest];
        if (!authorization.active) revert InvalidX402Authorization();
        authorization.active = false;
        emit X402AuthorizationRevoked(digest);
    }

    function _approve(uint256 requestId) internal {
        PendingApproval storage approval = _pending[requestId];
        if (approval.status != ApprovalStatus.Pending) revert ApprovalNotPending(requestId);
        if (approval.expiresAt < block.timestamp) revert ApprovalExpired(requestId);
        approval.status = ApprovalStatus.Approved;
        if (approval.key != owner) pendingCount[approval.key] -= 1;
        _call(approval.target, approval.value, approval.data);
        emit ApprovalApproved(requestId, approval.passportHash);
        emit CallExecuted(owner, approval.target, approval.recipient, approval.value, approval.selector, approval.passportHash);
    }

    function _validateSignature(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash
    ) internal override returns (uint256 validationData) {
        if (block.chainid != 84532 && block.chainid != 31337) revert UnsupportedChain(block.chainid);
        bytes calldata signature = userOp.signature;
        if (signature.length == 65) {
        if (_recoverCalldata(userOpHash, signature) != owner) revert InvalidSignature();
            return 0;
        }

        (address key, uint48 dayBucket, bytes32 passportHash, bytes memory keySignature) =
            abi.decode(signature, (address, uint48, bytes32, bytes));
        if (_recoverMemory(userOpHash, keySignature) != key) revert InvalidSignature();
        if (key == address(0) || key == owner) revert KeyNotActive(key);
        if (key == riskController && riskController != address(0)) {
            return _validateRiskControllerOperation(userOp, key, dayBucket, passportHash);
        }
        if (paused) revert Paused();
        SessionKey storage config = sessionKeys[key];
        if (!config.active) revert KeyNotActive(key);
        if (uint192(userOp.nonce >> 64) != config.nonceKey) revert InvalidSignature();
        if (riskRestrictions[key].frozen) revert SessionKeySuspended(key);

        uint256 dayStart = uint256(dayBucket) * DAY_SECONDS;
        if (dayStart > type(uint48).max - (DAY_SECONDS - 1)) revert WrongDayBucket(dayBucket, 0);
        // Timestamp is intentionally not read during ERC-4337 validation. EntryPoint
        // applies this signed day window using returned validationData.

        uint256 gasUnits = _gasUnits(userOp);
        if (gasUnits > config.maxGasPerOp) revert GasLimitExceeded(gasUnits, config.maxGasPerOp);
        uint256 gasCost = gasUnits * _maxFeePerGas(userOp);
        uint256 nextGas = gasByBucket[key][dayBucket] + gasCost;
        if (nextGas > config.dailyGasCapWei) {
            revert DailyGasCapExceeded(gasByBucket[key][dayBucket], gasCost, config.dailyGasCapWei);
        }
        gasByBucket[key][dayBucket] = nextGas;

        bytes4 callSelector = _selectorCalldata(userOp.callData);
        uint48 validAfter = config.validAfter;
        uint48 validUntil = config.validUntil;
        if (validUntil == 0) validUntil = type(uint48).max;
        if (riskRestrictions[key].suspendedUntil > validAfter) validAfter = riskRestrictions[key].suspendedUntil;

        if (callSelector == this.executeWithPassport.selector) {
            (address callKey, address target, uint256 value, bytes memory data, bytes32 callPassport) =
                abi.decode(userOp.callData[4:], (address, address, uint256, bytes, bytes32));
            if (callKey != key || callPassport != passportHash) revert PassportHashMismatch();
            uint256 amount = _validateTransfer(key, config, target, value, data);
            _reserveSpend(key, config, dayBucket, amount);
        } else if (callSelector == this.requestApproval.selector) {
            (address callKey, address target, uint256 value, bytes memory data, string memory reason, bytes32 callPassport) =
                abi.decode(userOp.callData[4:], (address, address, uint256, bytes, string, bytes32));
            if (callKey != key || callPassport != passportHash) revert PassportHashMismatch();
            if (target == address(0) || data.length > MAX_APPROVAL_DATA_BYTES) revert ApprovalDataTooLarge();
            if (bytes(reason).length > MAX_REASON_BYTES) revert ReasonTooLarge();
            if (pendingCount[key] >= config.maxPending) revert ApprovalQueueFull(key);
            if (approvalRequestsByBucket[key][dayBucket] >= config.maxRequestsPerDay) {
                revert ApprovalRequestBudgetExceeded(key, dayBucket);
            }
            value; // Owner approval may later authorize value transfer.
        } else if (callSelector == this.authorizeX402.selector) {
            (
                address callKey,
                bytes32 digest,
                address token,
                address recipient,
                uint256 amount,
                uint48 authValidAfter,
                uint48 authValidBefore,
                bytes32 nonce,
                bytes32 callPassport
            ) = abi.decode(userOp.callData[4:], (address, bytes32, address, address, uint256, uint48, uint48, bytes32, bytes32));
            digest; nonce;
            if (callKey != key || callPassport != passportHash) revert PassportHashMismatch();
            if (
                token != config.token || token != policyToken ||
                !allowedCalls[key][token][EIP3009_TRANSFER_WITH_AUTHORIZATION]
            ) {
                revert TargetNotAllowed(token);
            }
            if (!allowedRecipients[key][recipient]) revert RecipientNotAllowed(recipient);
            if (authValidBefore <= authValidAfter) revert InvalidX402Authorization();
            uint256 perTxLimit = _effectivePerTxLimit(key, config);
            if (amount == 0 || amount > perTxLimit) revert PerTxLimitExceeded(amount, perTxLimit);
            _reserveSpend(key, config, dayBucket, amount);
            if (authValidAfter > validAfter) validAfter = authValidAfter;
            if (authValidBefore < validUntil) validUntil = authValidBefore;
        } else {
            revert UnsupportedSessionCall(callSelector);
        }

        uint48 bucketStart = uint48(dayStart);
        uint48 bucketEnd = uint48(dayStart + DAY_SECONDS - 1);
        if (bucketStart > validAfter) validAfter = bucketStart;
        if (bucketEnd < validUntil) validUntil = bucketEnd;
        if (validUntil < validAfter) revert KeyValidityInvalid();
        validationData = (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
    }

    function _validateTransfer(
        address key,
        SessionKey storage config,
        address target,
        uint256 value,
        bytes memory data
    ) internal view returns (uint256 amount) {
        if (value != 0 || data.length != 68 || _selectorMemory(data) != ERC20_TRANSFER) revert InvalidTransferShape();
        if (!allowedCalls[key][target][ERC20_TRANSFER]) revert SelectorNotAllowed(target, ERC20_TRANSFER);
        if (target != config.token) revert TargetNotAllowed(target);
        (address recipient, uint256 transferAmount) = abi.decode(_slice(data, 4), (address, uint256));
        if (!allowedRecipients[key][recipient]) revert RecipientNotAllowed(recipient);
        uint256 perTxLimit = _effectivePerTxLimit(key, config);
        if (transferAmount == 0 || transferAmount > perTxLimit) {
            revert PerTxLimitExceeded(transferAmount, perTxLimit);
        }
        return transferAmount;
    }

    function _reserveSpend(address key, SessionKey storage config, uint48 dayBucket, uint256 amount) internal {
        uint256 nextSpend = spentByBucket[key][dayBucket] + amount;
        uint256 dailyLimit = _effectiveDailyLimit(key, config);
        if (nextSpend > dailyLimit) {
            revert DailyLimitExceeded(spentByBucket[key][dayBucket], amount, dailyLimit);
        }
        spentByBucket[key][dayBucket] = nextSpend;
    }

    function _validateRiskControllerOperation(
        PackedUserOperation calldata userOp,
        address controller,
        uint48 dayBucket,
        bytes32 passportHash
    ) internal view returns (uint256 validationData) {
        if (controller == address(0) || uint192(userOp.nonce >> 64) != riskControllerNonceKey) {
            revert InvalidSignature();
        }
        if (_selectorCalldata(userOp.callData) != this.tightenRiskRestriction.selector) revert UnsupportedSessionCall(_selectorCalldata(userOp.callData));
        (
            address key,
            uint256 perTxLimit,
            uint256 dailyLimit,
            uint48 suspendedUntil,
            bool freezeAgent,
            uint8 riskScore,
            bytes32 reasonHash,
            bytes32 callPassportHash,
            uint64 callControllerEpoch
        ) = abi.decode(
            userOp.callData[4:],
            (address, uint256, uint256, uint48, bool, uint8, bytes32, bytes32, uint64)
        );
        if (callPassportHash != passportHash) revert PassportHashMismatch();
        if (callControllerEpoch != riskControllerEpoch) revert InvalidSignature();
        if (riskScore < 60 || riskScore > 100 || perTxLimit == 0 || dailyLimit == 0 || (freezeAgent && riskScore < 80)) {
            revert RiskRestrictionNotTightening();
        }
        SessionKey storage config = sessionKeys[key];
        RiskRestriction storage restriction = riskRestrictions[key];
        if (!config.active || key == owner) revert KeyNotActive(key);
        uint256 oldPerTx = restriction.perTxLimit == 0 ? config.perTxLimit : restriction.perTxLimit;
        uint256 oldDaily = restriction.dailyLimit == 0 ? config.dailyLimit : restriction.dailyLimit;
        if (
            perTxLimit > config.perTxLimit || perTxLimit > oldPerTx ||
            dailyLimit > config.dailyLimit || dailyLimit > oldDaily ||
            suspendedUntil < restriction.suspendedUntil ||
            (restriction.frozen && !freezeAgent)
        ) revert RiskRestrictionNotTightening();
        reasonHash; // Bound into the signed call and emitted in the confirmed restriction event.
        uint256 dayStart = uint256(dayBucket) * DAY_SECONDS;
        if (dayStart > type(uint48).max - (DAY_SECONDS - 1)) revert WrongDayBucket(dayBucket, 0);
        uint48 validAfter = uint48(dayStart);
        uint48 validUntil = uint48(dayStart + DAY_SECONDS - 1);
        validationData = (uint256(validUntil) << 160) | (uint256(validAfter) << 208);
    }

    function _effectivePerTxLimit(address key, SessionKey storage config) internal view returns (uint256) {
        uint256 restriction = riskRestrictions[key].perTxLimit;
        return restriction == 0 || restriction > config.perTxLimit ? config.perTxLimit : restriction;
    }

    function _effectiveDailyLimit(address key, SessionKey storage config) internal view returns (uint256) {
        uint256 restriction = riskRestrictions[key].dailyLimit;
        return restriction == 0 || restriction > config.dailyLimit ? config.dailyLimit : restriction;
    }

    function _requireSessionNotRestricted(address key) internal view {
        RiskRestriction storage restriction = riskRestrictions[key];
        if (restriction.frozen || block.timestamp < restriction.suspendedUntil) revert SessionKeySuspended(key);
    }

    function _sessionAuthorizationActive(address key) internal view returns (bool) {
        SessionKey storage config = sessionKeys[key];
        RiskRestriction storage restriction = riskRestrictions[key];
        return config.active && !restriction.frozen && block.timestamp >= restriction.suspendedUntil &&
            block.timestamp >= config.validAfter && (config.validUntil == 0 || block.timestamp <= config.validUntil);
    }

    function _requireSessionKeyValid(address key, SessionKey storage config) internal view {
        if (block.timestamp < config.validAfter) revert KeyNotYetValid(config.validAfter);
        if (config.validUntil != 0 && block.timestamp > config.validUntil) revert KeyExpired(config.validUntil);
        if (riskRestrictions[key].suspendedUntil > block.timestamp) revert SessionKeySuspended(key);
    }

    function _gasUnits(PackedUserOperation calldata userOp) internal pure returns (uint256) {
        uint256 accountGasLimits = uint256(userOp.accountGasLimits);
        uint256 verificationGas = uint128(accountGasLimits >> 128);
        uint256 callGas = uint128(accountGasLimits);
        uint256 paymasterVerificationGas;
        uint256 paymasterPostOpGas;
        bytes calldata paymasterAndData = userOp.paymasterAndData;
        if (paymasterAndData.length != 0) {
            if (paymasterAndData.length < 52) revert InvalidSignature();
            paymasterVerificationGas = uint128(bytes16(paymasterAndData[20:36]));
            paymasterPostOpGas = uint128(bytes16(paymasterAndData[36:52]));
        }
        return verificationGas + callGas + userOp.preVerificationGas + paymasterVerificationGas + paymasterPostOpGas;
    }

    function _maxFeePerGas(PackedUserOperation calldata userOp) internal pure returns (uint256) {
        return uint128(uint256(userOp.gasFees));
    }

    function _call(address target, uint256 value, bytes memory data) internal returns (bytes memory result) {
        if (target == address(0)) revert ZeroAddress();
        bool success;
        (success, result) = target.call{value: value}(data);
        if (!success) revert CallFailed(target, result);
    }

    function _selectorCalldata(bytes calldata data) internal pure returns (bytes4 selector) {
        if (data.length >= 4) assembly ("memory-safe") { selector := calldataload(data.offset) }
    }

    function _selectorMemory(bytes memory data) internal pure returns (bytes4 selector) {
        if (data.length >= 4) assembly ("memory-safe") { selector := mload(add(data, 32)) }
    }

    function _tryDecodeTransfer(bytes calldata data) internal pure returns (address recipient, uint256 amount) {
        if (data.length != 68 || _selectorCalldata(data) != ERC20_TRANSFER) return (address(0), 0);
        (recipient, amount) = abi.decode(data[4:], (address, uint256));
    }

    function _slice(bytes memory data, uint256 start) internal pure returns (bytes memory result) {
        result = new bytes(data.length - start);
        for (uint256 i; i < result.length; ++i) result[i] = data[start + i];
    }

    function _recoverMemory(bytes32 digest, bytes memory signature) internal pure returns (address signer) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        signer = ecrecover(digest, v, r, s);
    }

    function _recoverCalldata(bytes32 digest, bytes calldata signature) internal pure returns (address signer) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        signer = ecrecover(digest, v, r, s);
    }

    receive() external payable {}
}
