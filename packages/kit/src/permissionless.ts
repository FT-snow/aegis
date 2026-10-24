import {
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  type Address,
  type Chain,
  type Client,
  type Hex,
  type LocalAccount,
  type PublicClient,
  type Transport,
} from "viem";
import {
  entryPoint07Abi,
  getUserOperationHash,
  toSmartAccount,
  type UserOperation,
  type UserOperationRequest,
} from "viem/account-abstraction";
import { createSmartAccountClient, type SmartAccountClient } from "permissionless";
import { AegisAccountAbi, ERC20TransferAbi, EntryPoint07Abi, entryPoint07Address } from "./abi.js";

export type AegisSigner = Pick<LocalAccount, "address"> & {
  sign: NonNullable<LocalAccount["sign"]>;
};

export type AegisSignatureMode =
  | { type: "owner" }
  | { type: "session"; dayBucket: number; passportHash: Hex; nonceKey: bigint }
  | { type: "risk-controller"; dayBucket: number; passportHash: Hex; nonceKey: bigint };

export interface AegisSmartAccountParameters {
  client: PublicClient<Transport, Chain | undefined>;
  factory: Address;
  owner: Address;
  signer: AegisSigner;
  mode: AegisSignatureMode;
  salt?: bigint;
  entryPoint?: Address;
}

const sessionSignatureParameters = [
  { name: "key", type: "address" },
  { name: "dayBucket", type: "uint48" },
  { name: "passportHash", type: "bytes32" },
  { name: "signature", type: "bytes" },
] as const;

function toOperation(operation: UserOperationRequest<"0.7">, sender: Address): UserOperation<"0.7"> {
  return {
    sender,
    nonce: operation.nonce ?? 0n,
    ...(operation.factory ? { factory: operation.factory } : {}),
    ...(operation.factoryData ? { factoryData: operation.factoryData } : {}),
    callData: operation.callData ?? "0x",
    callGasLimit: operation.callGasLimit ?? 0n,
    verificationGasLimit: operation.verificationGasLimit ?? 0n,
    preVerificationGas: operation.preVerificationGas ?? 0n,
    maxFeePerGas: operation.maxFeePerGas ?? 0n,
    maxPriorityFeePerGas: operation.maxPriorityFeePerGas ?? 0n,
    ...(operation.paymaster ? { paymaster: operation.paymaster } : {}),
    ...(operation.paymasterVerificationGasLimit !== undefined ? { paymasterVerificationGasLimit: operation.paymasterVerificationGasLimit } : {}),
    ...(operation.paymasterPostOpGasLimit !== undefined ? { paymasterPostOpGasLimit: operation.paymasterPostOpGasLimit } : {}),
    ...(operation.paymasterData ? { paymasterData: operation.paymasterData } : {}),
    signature: "0x" as Hex,
  };
}

/** Create Aegis ERC-4337 v0.7 account adapter for Pimlico permissionless.js. */
export async function toAegisSmartAccount(parameters: AegisSmartAccountParameters) {
  const { client, owner, signer, mode } = parameters;
  const factory = getAddress(parameters.factory);
  const entryPointAddress = getAddress(parameters.entryPoint ?? entryPoint07Address);
  const salt = parameters.salt ?? 0n;
  const signerAddress = getAddress(signer.address);
  const isSession = mode.type === "session";
  if (mode.type !== "owner" && signerAddress === getAddress(owner)) throw new Error("Delegated signer must differ from wallet owner");

  const address = await client.readContract({
    address: factory,
    abi: AegisAccountAbi,
    functionName: "getAddress",
    args: [getAddress(owner), salt],
  });

  const getFactoryArgs = async () => ({
    factory,
    factoryData: encodeFunctionData({
      abi: AegisAccountAbi,
      functionName: "createAccount",
      args: [getAddress(owner), salt],
    }),
  });

  return toSmartAccount({
    client,
    entryPoint: { address: entryPointAddress, abi: entryPoint07Abi, version: "0.7" },
    getAddress: async () => address,
    getFactoryArgs,
    async getNonce({ key } = {}) {
      const nonceKey = key ?? (mode.type === "owner" ? 0n : mode.nonceKey);
      return client.readContract({
        address: entryPointAddress,
        abi: EntryPoint07Abi,
        functionName: "getNonce",
        args: [address, nonceKey],
      });
    },
    async encodeCalls(calls) {
      if (calls.length !== 1) throw new Error("Aegis account accepts exactly one policy call per UserOp");
      const call = calls[0];
      if (!call) throw new Error("Missing call");
      const target = getAddress(call.to as Address);
      const value = call.value ?? 0n;
      const data = call.data ?? "0x";
      if (mode.type === "owner") {
        return encodeFunctionData({
          abi: AegisAccountAbi,
          functionName: "execute",
          args: [target, value, data],
        });
      }
      if (mode.type === "risk-controller") {
        if (target !== address) throw new Error("Risk controller can only call AegisAccount.tightenRiskRestriction");
        const decoded = decodeFunctionData({ abi: AegisAccountAbi, data });
        if (decoded.functionName !== "tightenRiskRestriction" || decoded.args[7] !== mode.passportHash) {
          throw new Error("Risk controller UserOp must bind the configured Decision Passport and only tighten restrictions");
        }
        return data;
      }

      if (target === address) {
        const decoded = decodeFunctionData({ abi: AegisAccountAbi, data });
        if (decoded.functionName === "requestApproval") {
          if (decoded.args[0] !== signerAddress || decoded.args[5] !== mode.passportHash) {
            throw new Error("Approval request key/passport does not match the active session signer");
          }
          return data;
        }
        if (decoded.functionName === "authorizeX402") {
          if (decoded.args[0] !== signerAddress || decoded.args[8] !== mode.passportHash) {
            throw new Error("x402 authorization key/passport does not match the active session signer");
          }
          return data;
        }
        throw new Error("Session signer may only submit bounded transfer, approval, or x402 account calls");
      }

      if (value !== 0n) throw new Error("Session transfer call cannot transfer native currency");
      const decodedTransfer = decodeFunctionData({ abi: ERC20TransferAbi, data });
      if (decodedTransfer.functionName !== "transfer" || decodedTransfer.args[1] === undefined) {
        throw new Error("Session call must be one ERC-20 transfer; use approval or x402 authorization helpers for exceptions");
      }
      return encodeFunctionData({
        abi: AegisAccountAbi,
        functionName: "executeWithPassport",
        args: [signerAddress, target, value, data, mode.passportHash],
      });
    },
    async decodeCalls(callData) {
      try {
        const decoded = decodeFunctionData({ abi: AegisAccountAbi, data: callData });
        if (decoded.functionName === "execute") {
          return [{ to: decoded.args[0], value: decoded.args[1], data: decoded.args[2] }];
        }
        if (decoded.functionName === "executeWithPassport") {
          return [{ to: decoded.args[1], value: decoded.args[2], data: decoded.args[3] }];
        }
      } catch {
        // Administrative UserOps use an explicit account self-call as target.
      }
      return [{ to: address, data: callData, value: 0n }];
    },
    async getStubSignature(operation) {
      if (!operation) return "0x";
      const hash = getUserOperationHash({
        userOperation: toOperation(operation, address),
        entryPointAddress,
        entryPointVersion: "0.7",
        chainId: client.chain?.id ?? 84532,
      });
      const sig = await signer.sign({ hash });
      if (mode.type === "owner") return sig;
      return encodeAbiParameters(sessionSignatureParameters, [
        signerAddress,
        mode.dayBucket,
        mode.passportHash,
        sig,
      ]);
    },
    async signUserOperation(operation) {
      const hash = getUserOperationHash({
        userOperation: toOperation(operation, address),
        entryPointAddress,
        entryPointVersion: "0.7",
        chainId: operation.chainId ?? client.chain?.id ?? 84532,
      });
      const sig = await signer.sign({ hash });
      if (mode.type === "owner") return sig;
      return encodeAbiParameters(sessionSignatureParameters, [
        signerAddress,
        mode.dayBucket,
        mode.passportHash,
        sig,
      ]);
    },
    async signMessage() {
      throw new Error("Aegis UserOp signer cannot sign arbitrary personal messages");
    },
    async signTypedData() {
      throw new Error("Use explicit owner/session EIP-712 signer; Aegis account signing is UserOp-only");
    },
  });
}

export function createAegisBundlerClient<
  transport extends Transport,
  chain extends Chain,
  account extends Awaited<ReturnType<typeof toAegisSmartAccount>>,
>(parameters: {
  account: account;
  chain: chain;
  bundlerTransport: transport;
  client?: Client<Transport, Chain | undefined, LocalAccount | undefined>;
}) {
  return createSmartAccountClient({
    account: parameters.account,
    chain: parameters.chain,
    client: parameters.client,
    bundlerTransport: parameters.bundlerTransport,
  }) as SmartAccountClient<transport, chain, account>;
}

export function encodeAegisApprovalRequestCall(input: {
  account: Address;
  key: Address;
  target: Address;
  value?: bigint;
  data: Hex;
  reason: string;
  passportHash: Hex;
}) {
  return {
    to: getAddress(input.account),
    value: 0n,
    data: encodeFunctionData({
      abi: AegisAccountAbi,
      functionName: "requestApproval",
      args: [getAddress(input.key), getAddress(input.target), input.value ?? 0n, input.data, input.reason, input.passportHash],
    }),
  } as const;
}

export function encodeAegisX402AuthorizationCall(input: {
  account: Address;
  key: Address;
  digest: Hex;
  token: Address;
  recipient: Address;
  amount: bigint;
  validAfter: number;
  validBefore: number;
  nonce: Hex;
  passportHash: Hex;
}) {
  return {
    to: getAddress(input.account),
    value: 0n,
    data: encodeFunctionData({
      abi: AegisAccountAbi,
      functionName: "authorizeX402",
      args: [
        getAddress(input.key), input.digest, getAddress(input.token), getAddress(input.recipient),
        input.amount, input.validAfter, input.validBefore, input.nonce, input.passportHash,
      ],
    }),
  } as const;
}

export function encodeAegisRiskRestrictionCall(input: {
  account: Address;
  key: Address;
  perTxLimit: bigint;
  dailyLimit: bigint;
  suspendedUntil: number;
  freezeAgent: boolean;
  riskScore: number;
  reasonHash: Hex;
  passportHash: Hex;
  controllerEpoch: bigint;
}) {
  if (input.riskScore < 60 || input.riskScore > 100) throw new Error("Risk controller only applies high/critical restrictions");
  return {
    to: getAddress(input.account),
    value: 0n,
    data: encodeFunctionData({
      abi: AegisAccountAbi,
      functionName: "tightenRiskRestriction",
      args: [
        getAddress(input.key), input.perTxLimit, input.dailyLimit, input.suspendedUntil,
        input.freezeAgent, input.riskScore, input.reasonHash, input.passportHash, input.controllerEpoch,
      ],
    }),
  } as const;
}

export function encodeAegisRiskRecoveryCall(input: {
  account: Address;
  key: Address;
  recoveryReasonHash: Hex;
}) {
  return {
    to: getAddress(input.account),
    value: 0n,
    data: encodeFunctionData({
      abi: AegisAccountAbi,
      functionName: "clearRiskRestriction",
      args: [getAddress(input.key), input.recoveryReasonHash],
    }),
  } as const;
}
