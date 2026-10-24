import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, "../..");
const sourcePaths = [
  "contracts/src/AegisAccount.sol",
  "contracts/src/AegisAccountFactory.sol",
  "contracts/test/AegisAccountSecurity.t.sol",
];
const sources = Object.fromEntries(sourcePaths.map((sourcePath) => [
  sourcePath,
  { content: readFileSync(path.join(root, sourcePath), "utf8") },
]));

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 10_000 },
    viaIR: true,
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

function findImport(importPath) {
  const candidates = [
    path.resolve(root, importPath),
    path.resolve(root, "node_modules", importPath),
  ];
  for (const candidate of candidates) {
    try {
      return { contents: readFileSync(candidate, "utf8") };
    } catch {
      // Try the next configured source root.
    }
  }
  return { error: `Unable to resolve Solidity import: ${importPath}` };
}

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImport }));
const errors = (output.errors ?? []).filter((entry) => entry.severity === "error");
for (const entry of output.errors ?? []) {
  if (entry.severity === "error") console.error(entry.formattedMessage);
}
if (errors.length > 0) process.exit(1);

const compiled = Object.entries(output.contracts ?? {}).flatMap(([source, contracts]) =>
  Object.keys(contracts).map((name) => `${source}:${name}`),
);
console.log(`Compiled ${compiled.length} Solidity contracts with optimizer + viaIR:`);
for (const contract of compiled) console.log(`- ${contract}`);
