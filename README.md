<div align="center">

# Mohar · मोहर

### Insurers pay. Diagnoses stay sealed.

**Privacy-preserving health records and zero-knowledge insurance claims**
Hackasol 5.0 · Track 4 (Web3) · W3-01

`Noir` · `UltraHonk` · `Solidity` · `Anon Aadhaar` · `IPFS` · `HL7 FHIR R4` · `ABDM` · `React`

</div>

---

A hospital proves a health-insurance claim is valid with a **zero-knowledge proof generated in its own browser**.
A smart contract verifies it and pays in seconds. The insurer never sees the diagnosis, the procedure, the bill,
or **which hospital** filed it, and the **payment doesn't leak it either**. Patients own their records, approve
every claim, and can unlock an emergency card through 2-of-3 guardians.

![How a claim works](docs/diagrams/1-overview.png)

## Why

**Mohar** (मोहर) means two things in Hindi/Urdu: an official **seal** that certifies a document, and a gold **coin**.
That's the product: a seal that proves a claim is valid, and the money that moves because of it.

To get a cashless claim paid today, a hospital sends the insurer the patient's full file: diagnosis, prescriptions,
itemised bills. Claims desks, third-party administrators and reviewers read it by hand, and it is stored in claims
databases forever. That causes three problems:

- **Privacy.** A cancer, HIV, IVF or psychiatric diagnosis is seen by strangers and sits in databases that leak. In
  September 2024, names, medical reports and claims of roughly 31 million policyholders of one of India's largest
  health insurers were reportedly leaked online.
- **Speed.** Every claim waits for a human to read documents and send queries back, while the patient waits at discharge.
- **Fraud.** Despite all that reading, an estimated ₹8,000–10,000 crore a year is lost to claim fraud, waste and abuse
  (BCG × Medi Assist, 2025).

Mohar replaces the documents with a **zero-knowledge seal**. The hospital proves the claim follows every rule of the
policy, and the insurer's smart contract checks that proof and pays automatically. The rules are: licensed hospital,
active policy, covered treatment, within the limit, never claimed before, the patient agreed, and the payout can't be
redirected. The insurer learns the amount and that the claim is valid, nothing else. Reading a file isn't needed to
catch fraud, because a fraudulent claim can't produce a valid seal in the first place.

Hiding the diagnosis inside a proof isn't enough on its own. If the contract then pays the public wallet of an
oncology, IVF or HIV clinic, **the payment itself reveals the diagnosis**. Mohar hides the hospital inside a Merkle set
of all licensed hospitals, pays a **fresh one-time address** (or a Zcash shielded address) per claim, and submits
through a **relayer**, so not even the transaction sender identifies the hospital.

## Quick start

```bash
pnpm install
./scripts/demo.sh            # fresh local chain → deploy → seed → API :8787 → app http://localhost:5173
```

Prerequisites: Node 20+, pnpm, [Foundry](https://book.getfoundry.sh), and `nargo` 1.0.0 (`noirup`). The prover (`bb`) ships
inside `@aztec/bb.js`.

Anon Aadhaar onboarding uses proofs generated once per patient (snarkjs takes about 1.5–4 minutes on a laptop):

```bash
node sdk/scripts/aadhaar-prove.mjs <patient-wallet-address>
```

### Sign in with MetaMask

`./scripts/demo.sh` creates a wallet for every role (`.role-wallets.json`, gitignored), funds each with 100 test ETH,
deploys with the regulator's key, and writes **`ROLE-WALLETS.local.md`**: every role's address and private key, plus
the network details.

1. MetaMask → *Add network manually*: RPC `http://127.0.0.1:8545`, chain ID `31337`, currency `ETH`. The sign-in
   page's *Add / switch network* button does this for you.
2. *Import account* → paste the keys of the roles you want to play.
3. Open <http://localhost:5173/#/login> → **Connect MetaMask** → pick the accounts → **Sign in** next to a role.

Every transaction and signature now pops up in MetaMask. Decryption and consent keys are **derived from a MetaMask
signature** (`personal_sign` is deterministic), so they are never stored anywhere and never touch the chain.
Hospitals sign in with a staff key but never send transactions: the relayer does, so the hospital stays anonymous
on-chain. Story mode, the Attack Lab and X-Ray keep using built-in keys so they run without pop-ups. After a chain
restart, use MetaMask → Settings → Advanced → *Clear activity tab data* if a transaction gets stuck on a stale nonce.

### Base Sepolia (live)

Deployed: `ClaimSettlement` [`0x89f4C648…2580`](https://sepolia.basescan.org/address/0x89f4C64836068f613183B58853491CE9ad7c2580).

```bash
./scripts/run-testnet.sh                       # API + app against Base Sepolia; tx links open BaseScan
DEPLOYER_KEY=0x… ./scripts/deploy-testnet.sh   # (re)deploy: fresh role wallets, patient Aadhaar proofs, fund, deploy, seed
cd sdk && CHAIN_ID=84532 RPC_URL=https://base-sepolia-rpc.publicnode.com ROLE_KEYS=../.testnet-keys.json \
  npx tsx scripts/renew-policy.ts asha         # give Asha a fresh full policy after test claims use up her cover
```

The deploy needs only ~0.001 ETH: the whole deploy is ~0.00014 ETH, each claim ~0.000024 ETH (mostly Base's L1 data
fee for the 8.8 KB proof). In MetaMask, add the network with RPC `https://base-sepolia-rpc.publicnode.com` and chain
ID `84532`, then import the keys from `ROLE-WALLETS.base-sepolia.md` (gitignored).

### Presenting: Live demo with role sign-in

**Live demo** opens a sign-in screen with every party as a real wallet on the chain: 2 patients, 4 hospitals, the
insurer, a doctor, a lab, a pharmacy, the regulator, a paramedic and 3 guardians. Signing in signs a fresh challenge
with that wallet. Each **browser tab keeps its own role**, so you can put Patient, Hospital and Insurer side by side.
Each role sees only its own app, and the others are locked out.

- The **Demo guide** panel (right) lists the whole workflow in 11 steps. It ticks each one from live chain state and
  tells you which role to sign in as next.
- **Under the hood** (same panel) logs every real operation as it happens: encryption, IPFS pins, transactions with
  block and gas, proof size and time. Each entry is tagged *stays on device*, *leaves encrypted* or *public*.
- **QR codes are real:** the hospital scans the patient's Mohar card at admission, the paramedic scans the
  lock-screen emergency QR, and the patient scans the UIDAI test-mode Aadhaar QR. Each uses the camera, a photo
  upload, or a one-click demo shortcut.
- **Open a role on a phone:** use the QR icon on any sign-in card or in the role menu. Phones need a secure context
  for WebCrypto and the camera, so start with `HTTPS=1 ./scripts/demo.sh` and accept the self-signed certificate.
- `?as=<role>` in a URL signs that tab in directly, e.g. `/?as=hospital-1#/seal`.

### Presenting: Story mode

The app opens on **Story mode**, an animated scene made for judges. It has three rooms: Asha's phone and the hospital
(private) and the public blockchain. It opens on **"Today"**: the file being copied to four strangers. Then each press
of **→** runs the real step and animates it. Her Aadhaar is blacked out except "18+ · Delhi". The medical file locks
and only a locked copy is stored. Asha's phone checks the numbers and signs. The hospital's **mohar press** lights up
7 rules and stamps a wax seal saying only "valid, ₹73,800". The seal alone crosses into public, the contract ticks its
checks, and coins move into a one-time wallet. The insurer's lens shows the amount next to black bars. A scanner beam
searches the whole chain: 0 private details found. Finally a fraudster replays the seal and is rejected.
**V** switches to the detailed device view.

| Key | Action |
|---|---|
| `→` / `Space` | run the current step, then advance |
| `←` | previous step |
| `1` `2` `3` | zoom patient / hospital / insurer |
| `V` | scene view ↔ detailed device view |
| `X` | x-ray: tag every field private or public |
| `H` | show / hide *How it works* + the live *Under the hood* log for the current step |
| `R` | restart the story |
| `?` | show keys |

After the first run the app works offline: fonts are bundled and the prover's CRS is mirrored by the API.

## How it works

![Technical flow](docs/diagrams/2-technical.png)

1. **Identity:** the patient proves with **Anon Aadhaar** that they hold a genuine UIDAI-signed Aadhaar and are 18+,
   revealing only their state. The proof is bound to their wallet, and an app-scoped nullifier allows one Aadhaar per account.
2. **Policy:** the insurer issues a policy. Only a Poseidon2 **commitment** goes on-chain; the terms never change afterwards.
   The patient's key inside it is a per-policy **consent key** derived from a wallet signature, so it is never on-chain.
3. **Encounter:** the hospital writes an HL7 FHIR R4 record, encrypts it with AES-256-GCM, and pins it to IPFS.
   The consent request is ECIES-sealed to the patient.
4. **Consent:** the patient's device re-derives the payout, claim ID and signed digest from its own policy copy,
   then signs the exact terms.
5. **Proof:** the hospital proves seven statements in zero knowledge, in the browser.
6. **Settlement:** a relayer submits. `ClaimSettlement` checks the registry root, policy, nullifier, prior usage, date and pool,
   verifies the UltraHonk proof, and pays bINR to a one-time address.
7. **Insurer view:** amount + six checks. Diagnosis, procedure, bill, hospital and patient stay hidden.
8. **Leak scan:** every transaction and event on-chain is searched for each private value. Result: 0 matches.

### The circuit — `circuits/claim/src/main.nr`

| # | Statement proven | How |
|---|---|---|
| 1 | Hospital is licensed | knows a secret whose leaf `Poseidon2(D_HOSP, secret)` is in the regulator's Merkle root |
| 2 | Policy active on the claim date | opens the policy commitment; `start ≤ date < end`, past the waiting period |
| 3 | Procedure covered, diagnosis not excluded | covered-set Merkle root inside the commitment + exclusion list |
| 4 | Payout correct and within the limit | `payout = (Σbill − deductible)·(1 − copay)`; `used_before + payout ≤ sum insured` |
| 5 | Not claimed before | `nullifier = Poseidon2(D_NUL, salt, recordHash, procedure)` |
| 6 | Patient consented | secp256k1 signature over the exact terms, verified in-circuit |
| 7 | Payout can't be redirected | recipient + amount are public inputs bound into the signed digest |

**Public inputs (7):** hospital root · policy commitment · nullifier · claim date · used before · payout · recipient.
**45,596 gates**, about 8.6 KB proof, about 1–8 s to prove, about 2.8M gas to verify and settle.

### Contracts — `contracts/src`

| Contract | Responsibility |
|---|---|
| `Regulator` | ABDM HFR-attested hospital listings, Merkle root (instant revocation of old roots), NMC-verified clinicians, insurers, pause |
| `ClaimSettlement` | immutable policy commitments, insurer pools, `submitClaim` (nullifiers, usage, date window, proof), payout |
| `HonkVerifier` | generated UltraHonk verifier for the claim circuit |
| `PatientRegistry` | Anon Aadhaar verification: one Aadhaar = one account |
| `HealthVault` | record hashes + CIDs, time-bound role grants with wrapped keys, `AccessLogged` audit trail, re-key on revoke |
| `BreakGlass` | 2-of-3 guardian emergency access with Shamir shares re-wrapped to the responder, 24 h window, logged views |
| `BINR` | demo rupee stablecoin (2 decimals = paise) |

## Features

| | |
|---|---|
| **Patient Vault** | Anon Aadhaar identity · encrypted FHIR records · share for 1h/24h/7d · revoke = re-encrypt · on-chain audit trail · consent inbox · emergency QR + guardians |
| **Hospital Seal** | ICD-10 smart search (73k codes, plain-language terms) · HAPI FHIR import · itemised bill · in-browser proof with live progress · Ghost Pay receivables |
| **Insurer Blind Desk** | pool, auto-settled claims (amount + checks only), policy issuance and renewal |
| **Doctor · Lab · Pharmacy** | see only what a patient shares, only while access lasts; every open is logged on-chain first. The lab gets just the lab slice (Observation) and the pharmacy just the prescription slice (MedicationRequest + allergies), re-encrypted as separate records |
| **Regulator** | ABDM HFR check → attest → approve → publish root · revoke · NMC clinicians · emergency pause |
| **Paramedic · Guardians** | paramedic scans the emergency QR → 2 of 3 guardians (each signed in separately) release shares → card opens for 24 h |
| **Attack Lab** | 15 one-click fraud attempts against the real circuit and contracts |
| **X-Ray** | hospital's private witness next to the public chain + full-chain leak scan |

## Security

**Attack Lab: 14 / 14 attacks blocked** (plus an honest control claim that settles).

| Stopped by the circuit (no proof can exist) | Stopped by the contract |
|---|---|
| unlicensed hospital · expired policy · waiting period · uncovered procedure · excluded diagnosis · over the limit · forged patient consent | replay · lying about prior usage · inflated payout · front-run recipient · forged registry root · duplicate Aadhaar · stolen Aadhaar proof |

Requirement-by-requirement checklist: [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) · threat model: [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) · architecture: [`docs/architecture.png`](docs/architecture.png)

## Tests

```bash
cd circuits/claim && nargo test             # circuit helpers
cd sdk && npx tsx --test test/claim.test.ts # 12 · real proof + 9 circuit-level attacks
cd contracts && forge test                  # 31 · real UltraHonk + real Anon Aadhaar proofs, attacks, flows
cd sdk && npx tsx scripts/leak-test.ts      # settles a claim, scans the entire chain for 16 private values
cd e2e && node story.mjs                    # Story mode end-to-end, keyboard only
cd e2e && node roles.mjs                    # Live demo by role sign-in: claim, sharing, revoke, break-glass, duplicate Aadhaar
cd e2e && node metamask.mjs                 # the same, every role signing through a scripted MetaMask (EIP-1193)
cd e2e && node smoke.mjs --flow --attacks   # every screen renders · claim settles · leak scan · 14 attacks
cd e2e && node smoke.mjs --attacks          # every screen + all Attack Lab scenarios in Chromium
cd e2e && node flows.mjs                    # share → audited open → revoke/re-key · break-glass · renewal
```

## Configuration

| Variable | Effect |
|---|---|
| `RPC_URL`, `CHAIN_ID`, `ROLE_KEYS` | run against another chain (`scripts/deploy-testnet.sh` deploys to Base Sepolia) |
| `HFR_LOOKUP_URL`, `ABDM_ACCESS_TOKEN` | live ABDM Health Facility Registry checks (otherwise a labelled offline snapshot) |
| `NMC_LIVE=1`, `NMC_DOCTOR_ID` | live NMC Indian Medical Register lookup |
| `PINATA_JWT` | mirror IPFS blobs to a public pinning service |
| `ZINGO_CLI` | Zcash light wallet for shielded Ghost Pay payouts |
| `AADHAAR_PUBKEY_HASH` | switch Anon Aadhaar from the UIDAI test key to production |

## Status

| Live | Demo / test mode |
|---|---|
| ZK claim proofs, all contracts, encryption, consent, relayer, one-time payouts, audit trail, break-glass, Attack Lab, leak scan, HAPI FHIR import, ICD-10 search | local chain (Base Sepolia script ready) · Anon Aadhaar with the UIDAI **test** key and pre-generated proofs · HFR/NMC against an offline snapshot · IPFS pinned on the API node · bINR demo token · synthetic people, hospital registry ids and policies · Zcash leg awaits a wallet |

**Roadmap:** unlinkable claims per policy (policies in a Merkle tree) · production UIDAI key · ABDM sandbox and NMC credentials ·
MetaMask for patients · Base mainnet · e₹/UPI settlement rail.

## Layout

```
circuits/claim   Noir claim circuit
contracts/       Foundry contracts, tests (real proof fixtures), deploy script
sdk/             TypeScript core: Poseidon2, Merkle, policy, claim, prover, records crypto, FHIR, registries, scripts
server/          Hono API: IPFS node, consent inbox, relayer, Ghost Pay bridge, registries, ICD-10, FHIR import, CRS mirror
app/             Vite + React app: Story mode + 6 role screens + Attack Lab + X-Ray
e2e/             Playwright suites, diagram + deck generators
docs/            diagrams, architecture, threat model, concept
pitch/           pitch deck (HTML + PDF)
JOURNAL.md       build journal
```

## Built with

[Noir](https://noir-lang.org) · [Barretenberg / bb.js](https://github.com/AztecProtocol/aztec-packages) ·
[Anon Aadhaar](https://github.com/anon-aadhaar/anon-aadhaar) (MIT; contracts in `contracts/src/AnonAadhaar*.sol` and test assets in `sdk/assets/anon-aadhaar`) ·
[Foundry](https://getfoundry.sh) · [ethers](https://docs.ethers.org) · [Hono](https://hono.dev) · [React](https://react.dev) + [Vite](https://vitejs.dev) ·
[Tailwind CSS](https://tailwindcss.com) · [lucide](https://lucide.dev) · [multiformats](https://github.com/multiformats/js-multiformats) ·
ICD-10-CM code list · [HAPI FHIR](https://hapi.fhir.org) public test server

## License

MIT
