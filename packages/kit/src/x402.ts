import { ExactEvmScheme } from "@x402/evm/exact/client";
import type { PaymentPayload, PaymentRequirements, ResourceInfo } from "@x402/core/types";
import { x402Client } from "@x402/core/client";
import { x402HTTPClient } from "@x402/core/http";
import { hashTypedData, getAddress, type Address, type Hex, type TypedData } from "viem";
import { EIP3009Types } from "./abi.js";

export interface EIP3009Authorization {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

export interface AegisX402AuthorizationRequest {
  chainId: number;
  token: Address;
  recipient: Address;
  amount: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  digest: Hex;
  passportHash: Hex;
}

export interface AegisX402AuthorizationReceipt {
  userOpHash: Hex;
  transactionHash: Hex;
  confirmed: true;
}

export interface AegisX402Payment {
  payload: PaymentPayload;
  headers: Record<string, string>;
  authorization: AegisX402AuthorizationRequest;
  receipt: AegisX402AuthorizationReceipt;
}

export interface CreateAegisX402PaymentParameters {
  requirements: PaymentRequirements;
  resource?: ResourceInfo;
  chainIdAllowlist: readonly number[];
  walletAddress: Address;
  sessionKey: {
    address: Address;
    signTypedData: (data: {
      domain: Record<string, unknown>;
      types: Record<string, unknown>;
      primaryType: string;
      message: Record<string, unknown>;
    }) => Promise<Hex>;
  };
  tokenAddress: Address;
  passportHash: Hex;
  /** Must submit policy-checked `authorizeX402` UserOp and wait for confirmed inclusion. */
  authorize: (request: AegisX402AuthorizationRequest) => Promise<AegisX402AuthorizationReceipt>;
}

/**
 * Build standard x402 EIP-3009 payment payload, then wait for a policy-authorized
 * Aegis UserOp that enables exactly this ERC-1271 digest. Does not broadcast payment.
 */
export async function createAegisX402Payment(
  parameters: CreateAegisX402PaymentParameters,
): Promise<AegisX402Payment> {
  const { requirements } = parameters;
  if (requirements.scheme !== "exact") throw new Error("Aegis only supports x402 exact payments");
  if (requirements.extra.assetTransferMethod && requirements.extra.assetTransferMethod !== "eip3009") {
    throw new Error("Aegis session-key x402 currently requires EIP-3009; Permit2 is not enabled");
  }
  const networkParts = /^eip155:(\d+)$/.exec(requirements.network);
  const chainId = Number(networkParts?.[1]);
  if (!networkParts || !Number.isSafeInteger(chainId) || !parameters.chainIdAllowlist.includes(chainId)) {
    throw new Error(`x402 network ${requirements.network} is outside Aegis chain allowlist`);
  }
  const walletAddress = getAddress(parameters.walletAddress);
  const tokenAddress = getAddress(parameters.tokenAddress);
  if (getAddress(requirements.asset) !== tokenAddress) throw new Error("x402 asset differs from configured Aegis policy token");
  if (getAddress(requirements.payTo) === walletAddress) throw new Error("x402 payee cannot be the payer account");
  if (!/^(0|[1-9][0-9]{0,77})$/.test(requirements.amount) || BigInt(requirements.amount) === 0n) {
    throw new Error("x402 amount must be a positive uint256 atomic amount");
  }
  if (!Number.isInteger(requirements.maxTimeoutSeconds) || requirements.maxTimeoutSeconds < 1 || requirements.maxTimeoutSeconds > 86_400) {
    throw new Error("x402 timeout must be between 1 second and 1 day");
  }
  if (typeof requirements.extra.name !== "string" || typeof requirements.extra.version !== "string") {
    throw new Error("EIP-3009 requires asset name and version in x402 requirements");
  }

  const signer = {
    address: walletAddress,
    signTypedData: parameters.sessionKey.signTypedData,
  };
  const scheme = new ExactEvmScheme(signer);
  const result = await scheme.createPaymentPayload(2, requirements);
  const authorization = (result.payload as { authorization?: EIP3009Authorization }).authorization;
  const signature = (result.payload as { signature?: Hex }).signature;
  if (!authorization || !signature) throw new Error("x402 EVM SDK did not return an EIP-3009 authorization");
  if (getAddress(authorization.from) !== walletAddress) throw new Error("x402 SDK payer differs from Aegis account");
  if (getAddress(authorization.to) !== getAddress(requirements.payTo)) throw new Error("x402 SDK payee differs from payment requirement");
  if (authorization.value !== requirements.amount) throw new Error("x402 SDK amount differs from payment requirement");

  const digest = hashTypedData({
    domain: {
      name: requirements.extra.name,
      version: requirements.extra.version,
      chainId,
      verifyingContract: tokenAddress,
    },
    types: EIP3009Types as unknown as TypedData,
    primaryType: "TransferWithAuthorization",
    message: {
      from: walletAddress,
      to: getAddress(authorization.to),
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce: authorization.nonce,
    },
  });

  const authorizationRequest: AegisX402AuthorizationRequest = {
    chainId,
    token: tokenAddress,
    recipient: getAddress(authorization.to),
    amount: authorization.value,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce,
    digest,
    passportHash: parameters.passportHash,
  };
  const receipt = await parameters.authorize(authorizationRequest);
  if (receipt.confirmed !== true || !receipt.userOpHash || !receipt.transactionHash) {
    throw new Error("Aegis x402 authorization must be confirmed on-chain before payment payload is released");
  }

  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: result.payload,
    ...(parameters.resource ? { resource: parameters.resource } : {}),
  };
  const http = new x402HTTPClient(new x402Client());
  return {
    payload,
    headers: http.encodePaymentSignatureHeader(payload),
    authorization: authorizationRequest,
    receipt,
  };
}
