# Kavach — Build Journal

> Hackasol 5.0 · Track 4 (Web3) · W3-01 Privacy-Preserving Health Records & ZKP Insurance Claims
> "Insurers pay. Diagnoses stay sealed."

This journal is written while building. Each entry says **what** was done, **how**, and **why**,
including dead ends.

---

## 0. Research & decisions (before code)

**Design goals:** cover every must-have of the brief, then close the gaps a naive ZK-claims design leaves open:
- the hospital's identity must stay hidden (not just the diagnosis), and so must the *payment recipient*;
- policy expiry, coverage and limits must be proven inside the circuit, not checked loosely by a contract;
- a revoked hospital must not keep proving against an old registry root;
- the patient must consent to every claim (no phantom-patient fraud), and splitting a bill must not dodge the cap;
- records must be truly patient-controlled (grant / revoke / audit), with real emergency access.

**Chain:** Zcash has no programmable contracts → cannot verify a custom proof (fails the "contract verifies proof"
must-have). Core runs on **EVM (Anvil local + Base Sepolia)**; Zcash is used for the private payout rail (Ghost Pay).

---

## 1. Toolchain (Day 0)

- `noirup` → **nargo 1.0.0**. Instead of the separate `bbup` installer we use the
  **`bb` binary that ships inside `@aztec/bb.js@5.3.0`** (npm). Same prover, also used in the browser.
- `std::hash::poseidon2` was removed from Noir's stdlib in 1.0 → using `noir-lang/poseidon v0.4.0`.
- Verified JS ↔ Noir hash compatibility: `Poseidon2([1,2])` = `0x0386…7383` in both. This matters because Merkle
  trees and commitments are built in TypeScript and opened inside the circuit.

## 2. The claim circuit (`circuits/claim/src/main.nr`)

One UltraHonk circuit, **45,596 gates**, 7 public inputs:

| Public | Meaning |
|---|---|
| `hospital_root` | Regulator's approved-hospital Merkle root |
| `policy_commitment` | Poseidon2 commitment to the whole policy (terms stay private) |
| `nullifier` | `H(policy_salt, record_hash, procedure)` — one claim per treatment, unlinkable |
| `claim_date` | Checked against block time by the contract |
| `used_before` | Contract-tracked amount already paid on this policy |
| `payout_amount` | Computed in-circuit from bill, deductible and co-pay |
| `payout_recipient` | One-time address (Ghost Pay) — bound so it can't be front-run |

Private: hospital secret + Merkle path, every policy field, diagnosis (ICD-10), procedure code + covered-set path,
itemised bill, record hash, patient's ECDSA consent signature.

Design choices:
- **Hospital identity hidden**: hospital proves knowledge of `secret` with `H(DOM, secret)` in the tree — no public key ever leaves.
- **Covered set is private too**: it's a Merkle root *inside* the policy commitment.
- **Exclusions + waiting period**: Indian health policies have pre-existing-disease waiting periods and exclusions; both are proven.
- **Claim-splitting blocked**: `used_before + payout <= sum_insured` with `used_before` supplied by the contract.
- **Fake-patient fraud blocked**: patient signs `H(nullifier, payout, recipient, date, policy)` with the secp256k1 key bound into the policy.
- `u1` was removed in Noir 1.0 → Merkle bits use `[bool; N]`.

Solidity verifier generated with `bb write_solidity_verifier -t evm` (ZK Honk).

## 3. SDK (`sdk/`) — one library for scripts, server and browser

- `hash.ts` Poseidon2 via bb.js (same WASM in Node and browser) + domain tags mirrored from the circuit.
- `merkle.ts` fixed-depth tree with precomputed empty subtrees.
- `policy.ts` policy model, covered-procedure tree, commitment, payout maths identical to the circuit.
- `claim.ts` nullifier, consent digest, patient signature (raw secp256k1, verified in-circuit), witness builder,
  **Ghost Pay one-time addresses** `keccak(hospitalSecret, nullifier)` → fresh wallet per claim.
- `records.ts` AES-256-GCM sealing, IPFS CIDv1 (sha2-256), ECIES key wrapping, **Shamir 2-of-3 over GF(256)**.
- `fhir.ts` HL7 FHIR R4 bundles (Patient, Organization with ABDM HFR id, Condition ICD-10, Procedure,
  MedicationRequest, AllergyIntolerance, Observation LOINC, Claim) + emergency card.

**Tests (`sdk/test/claim.test.ts`) — 11/11 pass.** A valid claim proves in **~1.75 s** (Node, single thread,
8,768-byte proof) and verifies. Nine attacks fail *inside the circuit* with their exact reason: unlicensed hospital,
expired policy, waiting period, uncovered procedure, excluded diagnosis, over-limit, forged consent, tampered payout,
revoked hospital. (Initial failure was my own arithmetic in the expected payout — ₹67,500 not ₹75,600.)

## 4. Contracts (`contracts/`)

| Contract | Job |
|---|---|
| `Regulator` | Hospital listings (HFR id), approve/revoke, Merkle root with 15-min grace for routine updates and **instant death of all old roots on revocation**, insurer approvals, pause switch |
| `ClaimSettlement` | Immutable policy commitments, insurer pools, `submitClaim` (anyone can relay), nullifiers, `used` tracking, `precheck()` reason codes, verifier gas cap |
| `HonkVerifier` | Generated by bb (17.7 KB — fits the 24 KB limit, deployable to Base Sepolia) |
| `HealthVault` | Records (hash + CID only), time-bound role grants with wrapped keys, re-key on revoke, `logAccess` audit trail |
| `BreakGlass` | 2-of-3 guardians, responder requests, share re-wrapping, 24h window, logged views |
| `BINR` | Demo rupee stablecoin, 2 decimals = paise |

**24/24 Foundry tests pass**, using a *real* proof fixture produced by `sdk/scripts/make-fixture.ts`:
replay, stale `used` (claim ordering), inflated payout, front-run recipient, wrong policy, flipped proof byte, unknown root,
revoked root, cancelled policy, too-old / future-dated claim, pause, empty pool, unapproved insurer, plus vault and
break-glass flows.

**Gas:** `submitClaim` ≈ **2.8–3.25M gas** (UltraHonk verification ≈ 3.1M). That's ~9× a Groth16 verifier, the price
of no trusted setup and ~2 s browser proving; on Base it's cents. A malformed proof originally burned ~1B gas inside
the verifier, so the call is now capped at 6M (`VERIFY_GAS_CAP`).

## 5. Local chain end-to-end (`sdk/scripts/seed.ts`, `e2e.ts`)

`forge script Deploy.s.sol` (links verifier libraries) → `seed.ts` creates the world: 4 real Chhattisgarh hospitals
(+1 unlicensed "Shady Clinic" left pending), on-chain root == locally rebuilt root, insurer "Suraksha Health" with a
₹1 crore pool, two policy commitments (Asha: Gold; Rahul: Basic still in waiting period), encrypted FHIR history on IPFS,
emergency card with guardian shares.

`e2e.ts` result: oncology claim (C50.9 / chemo) from Balco Medical Centre → proof 1.76 s → relayer submits →
block 109, 2.78M gas → **ghost address received ₹73,800** → replay reverts `NullifierUsed`. The chain never saw
"oncology", "Balco", or Asha's address.

## 6. API server (`server/`) — sees only ciphertext

Hono on Node, three jobs:
1. **IPFS pin node.** `PUT /api/ipfs` stores blobs under their CIDv1 (sha2-256, raw codec); `GET` re-hashes on read
   and refuses content that doesn't match its CID. Sanity check: `"hello"` → `bafkreibm6jg3ux5q…`, the canonical IPFS
   CID, so the store is interchangeable with any IPFS node. Optional Pinata mirror via `PINATA_JWT`.
2. **Consent inbox.** The hospital's request is sealed to the patient's key (ECIES) before it leaves the browser,
   so the server only sees a patient address and ciphertext.
3. **Relayer.** It `staticCall`s first (never pays gas for a doomed claim), then submits from its own wallet,
   so **the hospital's address never appears on-chain.**

**Ghost Pay Zcash rail** (`server/src/ghostpay.ts`): the proof binds the bridge as recipient; the bridge watches
`ClaimSettled` and forwards ZEC to the hospital's shielded unified address via `zingo-cli quicksend`, with the
nullifier in the encrypted memo. `zingo-cli` (the Zcash light wallet) isn't installed on our dev machine yet, so the rail is wired and tested up to the wallet call: a
settled Zcash-rail claim is queued as `awaiting-zcash-wallet`, never faked as paid. Installing `zingo-cli` locally
turns it on (see README).

## 7. Web app (`app/`) — Vite + React + Tailwind v4, proving in the browser

Next.js was the plan, but bb.js/noir_js WASM + workers are far less painful under Vite (the Noir team's own
examples use Vite), so we switched. COOP/COEP headers make the page cross-origin isolated, which enables
multithreaded proving.

| Screen | What it does |
|---|---|
| Overview | Live stats from chain, explains the payment-leak insight |
| 🗝 Vault (patient) | Policy card (commitment recomputed from the patient's own copy), **consent inbox that independently re-derives payout, nullifier and digest before signing**, records (decrypt / share for 1h, 24h or 7d / revoke + re-key), on-chain audit trail, guardians + emergency QR |
| 🏥 Seal (hospital) | Encounter form (ICD-10, procedure, itemised bill), live payout maths, rail picker, 6-step progress with live proof timer, Ghost Pay receivables |
| 👁 Blind Desk (insurer) | Pool, settled-claim feed showing the 6 proven statements next to 6 redacted fields, policy issuance (renewal with waiting-period continuity) |
| 🩺 Doctor | Records shared with her; **opening writes `AccessLogged` on-chain first**, blocked after revoke |
| ⚖ Regulator | Approve/revoke hospitals, root audit (recomputed in browser), root history, emergency pause |
| 🚑 Break-glass | Responder scans QR → guardians release Shamir shares re-wrapped to the responder → 2 shares reconstruct the key |
| 🧪 Attack Lab | 13 one-click scenarios against the real circuit and contract |
| 🩻 X-Ray | Private witness vs public chain side by side, plus an in-browser leak scan of the whole chain |

## 8. Browser verification (Playwright, headless Chromium)

- `e2e/smoke.mjs`: all 9 pages render, **0 console errors**.
- `--flow`: Seal → consent → Vault signs → in-browser proof (**7.9 s** single-thread headless WASM; native bb in Node
  is 1.75 s) → relayer → settled ₹73,800 to a one-time address. Total 36 s, including the human step.
- `--attacks`: **12/12 attacks blocked, control claim settles.** Circuit blocks: unlicensed hospital, expired
  policy, waiting period, uncovered procedure, excluded diagnosis, over limit, fake consent. Contract blocks:
  replay (`NullifierUsed`), lying about prior usage (`StaleUsedAmount`), inflated payout and front-run recipient
  (`InvalidProof`), forged registry (`UnknownHospitalRoot`).
- `flows.mjs`: share → doctor opens (audited) → revoke + re-key → doctor gets `NoAccess`; break-glass with 1 share
  can't decrypt, with 2 shares the emergency card opens; insurer renewal.
- `zcash.mjs`: the Zcash-rail claim settles to the bridge and queues the shielded payout.

**The leak scanner caught something.** The X-Ray scan flagged the patient's secp256k1 public key on-chain (from
`HealthVault.registerKey`). Analysis: it's public by design (any wallet that sends a tx reveals it), it sits inside
the policy commitment only as a salted hash, and it never appears in a claim transaction. The check is now scoped to
claim txs, with that explanation shown in the UI. Roadmap: a separate per-policy consent key makes even that link
impossible.

Bugs found and fixed along the way: renewed policies broke after reload (commitment was read from `demo.json` →
now always recomputed from the patient's copy); custom errors showed as "unknown custom error" → decoded against all ABIs.

## 9. CLI privacy leak test (`sdk/scripts/leak-test.ts`)

Settles a breast-cancer chemo claim at the oncology hospital, then downloads every tx and event of every Kavach
contract and searches 16 private values in every encoding (ASCII, field element, uint256):
**41 txs, 47 events, 51.8 KB scanned → PASS, 0 leaks.**

## 10. Deliverables

- **Architecture + threat-model diagram:** `docs/architecture.svg` / `.png`, `docs/THREAT_MODEL.md` (data placement,
  13 adversaries → mitigation → the test that proves it, known trade-offs).
- **Demo video:** `demo/kavach-demo.mp4` (3:42, 1440×900, H.264). Recorded by `e2e/record-demo.mjs`, which drives
  the *real* app on a fresh chain with on-screen captions: hook → vault → oncology admission → consent → in-browser
  proof → settled → insurer view → X-Ray + leak scan → Attack Lab (13 scenarios, sped up 8×) → share/open/revoke
  → break-glass (1 share fails, 2 succeed) → regulator → close. 0 page errors during recording.
  First take failed because the caption overlay intercepted clicks (`pointer-events:none` fixed it). Seal now
  resumes an in-flight claim after you visit the Vault, which the single-tab recording needed.
- **Pitch deck:** `pitch/deck.html` (15 slides, 1920×1080) → `pitch/Kavach-pitch.pdf`, built from real screenshots.
- **Testnet:** `scripts/deploy-testnet.sh` deploys and seeds Base Sepolia with *fresh* role keys (Anvil keys are
  public and get swept by bots even on testnets). Needs a funded `DEPLOYER_KEY`, which only the team can provide.

## 11. Final verification (same session, fresh chain)

| Suite | Result |
|---|---|
| `nargo test` | 2/2 |
| SDK (`tsx --test`) | 11/11 · native proof 1.17 s with 4 threads |
| Foundry | 24/24 |
| App typecheck | clean |
| Playwright smoke / flow / attacks / flows / zcash | all pass, 0 console errors |
| `leak-test.ts` | PASS, 0 private values on-chain |

## 12. What's left for the team

1. `DEPLOYER_KEY=0x… ./scripts/deploy-testnet.sh` with ~0.05 Base Sepolia ETH, for a public deployment.
2. Install `zingo-cli` (command in README) and fund it from a Zcash testnet faucet to make the shielded payout leg live.
3. Rehearse the 3-minute pitch with the video as backup.

---

## 13. Round 2 — every research item + a presentable UX

### Logic built from the research
| Item | What we built | Verified by |
|---|---|---|
| **Anon Aadhaar** | `PatientRegistry.sol` + vendored `AnonAadhaar.sol` / Groth16 `Verifier.sol` (test-mode UIDAI key). Proof bound to the wallet (signal), app-scoped nullifier → one Aadhaar = one account; reveals only age ≥ 18 + state. | 5 Foundry tests on **real** proofs (`contracts/test/fixtures/aadhaar-*.json`): valid (377k gas), stolen proof from another wallet, same Aadhaar on a 2nd account, tampered reveal, wrong seed |
| Proving cost | snarkjs on CPU: **232 s / 7 GB RAM** cold, **83 s** warm. Too slow for a live stage, so proofs are generated once at onboarding (`sdk/scripts/aadhaar-prove.mjs`, cached) and **verified on-chain live**. The first background run was OOM-killed while the demo stack was up; rerun alone. | |
| **ABDM HFR check** | `sdk/src/registry.ts` + `/api/registry/hfr/:id`: format, found, ACTIVE, name match, system of medicine → keccak attestation stored on-chain (`Regulator.attestHospital`). **Approval now reverts without an attestation.** Live mode via `HFR_LOOKUP_URL` + `ABDM_ACCESS_TOKEN`; otherwise a labelled offline snapshot. | `test_hospitalApprovalRequiresHfrAttestation`; Shady Clinic fails the check in the UI |
| **NMC clinicians** | `Regulator.registerClinician/suspendClinician`; `HealthVault` refuses Doctor-role grants to anyone not NMC-verified. Live NMC IMR lookup only when `NMC_LIVE=1`. | `test_doctorGrantRequiresNmcVerifiedClinician` |
| **HAPI FHIR import** | `/api/fhir/hapi` pulls a live Condition + Patient from `hapi.fhir.org/baseR4`; Seal maps its SNOMED display to ICD-10. | manual: returned SNOMED 35489007 "depression" |
| **ICD-10 smart search** | 73,390 ICD-10-CM codes offline, lay-term synonyms ("heart attack" → I21.9, "breast cancer" → C50.x). | API checks |
| **Per-policy consent keys** | The patient key inside a policy is derived from a wallet signature (`consentKeyFor`), so it's never on-chain and works with MetaMask's `personal_sign`. Leak test now checks the consent key across the *entire* chain. | SDK 11/11, leak test |

### Two real bugs found by our own tooling
1. **Record-hash linkability (found by the leak scanner).** The record id inside the nullifier was `keccak(ciphertext) mod p`, which equals the public `contentHash` in HealthVault whenever keccak < p (~19% of records). The insurer knows the policy salt, so it could link a claim to a vault record and wallet. Fixed: `recordHashField(bytes, recordKey)` is keyed with the record's AES key, so only patient and hospital can compute it. Scan: 1 hit → 0.
2. **Cached init failure.** If bb.js's first CRS download hit a network blip, the rejected promise was cached and *every* later proof failed ("Failed to fetch" ×12 in the Attack Lab). Fixed: retry on failure, **plus a local CRS mirror** (`/api/crs/*`, cached in `.cache/crs`) and **self-hosted fonts**, so the demo works on bad Wi-Fi or offline.

### UX overhaul
- **Design system:** light "medical record meets declassified file". Paper `#F5F2EA`, ink `#16181D`, violet = private, teal = public, green = verified, vermilion = blocked. Newsreader + Geist + Geist Mono, lucide icons, **every emoji removed**. Ink redaction bars, dashed device boundaries, perforated ledger rows. Attack Lab + X-Ray switch to a dark "lab" theme.
- **Story mode (default screen):** three devices side by side (Asha's phone · Balco's hospital desk · insurer Blind Desk), a "wire" strip showing exactly what crosses between them (packets with sizes), a 9-step stepper, serif narration + the on-chain line, and **one button / → key per step**. Every step runs the real action: on-chain Anon Aadhaar verify, IPFS + ECIES consent, patient re-derivation + signing, in-browser UltraHonk proof (with a constraint "loom" and PROVEN stamp), relayer settlement, insurer count-up with redactions, full-chain leak scan. Keys: → / Space, ←, 1/2/3 zoom, X x-ray tags, R restart, ? help.
- **IA:** sidebar of 9 pages → top bar `Story | Roles | Proof & Security`, role tabs with coloured markers.

### Verification (fresh chain)
| Suite | Result |
|---|---|
| Foundry | **31/31** (incl. real Anon Aadhaar proofs) |
| SDK | 11/11 |
| Story mode playthrough (`e2e/story.mjs`, keyboard only) | 10/10 steps, 0 errors, **leak scan 0 leaks** |
| Attack Lab in browser | **14/14 blocked** + control settles (incl. duplicate Aadhaar, stolen Aadhaar proof) |
| Role flows (`e2e/flows.mjs`) | share → audited open → revoke+re-key → NoAccess · break-glass 1 share fails / 2 open · renewal |
| CLI leak test | PASS |

The demo video was **not** re-recorded (the team asked not to); `demo/kavach-demo.mp4` still shows the previous UI.

---

## 14. Round 3: full audit, role sign-in, QR flows, a Story that shows its work

**Audit against the problem statement:** every must-have, bonus and deliverable re-tested on a fresh chain. See
`docs/REQUIREMENTS.md` for the mapping and results. The only open item is still the Base Sepolia deploy (needs a
funded key).

**Bugs found:**
- `demo.sh` only killed old anvil processes. An API server from an earlier run kept port 8787 (`EADDRINUSE`), so the
  fresh stack talked to a stale relayer and every claim and attack timed out. It now frees 8787 and 5173 first.
- **Anon Aadhaar "not working":** (1) the cached proofs live in gitignored `.cache/`, so a fresh clone got "no
  proof". The API now falls back to the identical real proofs in `contracts/test/fixtures/`. (2) The demo has one
  UIDAI test Aadhaar (Asha's). Verifying Rahul first silently claimed it, and then *Asha* was blocked with
  `DuplicateAadhaar`. Rahul's screen is now explicitly the "one Aadhaar, two accounts" attack and warns if Asha
  isn't verified yet.
- Wallet nonces drifted when the same role was used from two tabs. The signer now resets and retries on nonce errors.

**Built:**
- **Role sign-in** (`lib/session.ts`, `pages/Login.tsx`): 16 identities, a SIWE-style challenge signed by the role's
  wallet, one role per tab (sessionStorage), role-guarded screens, a quick-switch menu, `?as=` deep links, and a
  sign-in QR per role for phones. `HTTPS=1` gives a self-signed TLS cert because phones need it for WebCrypto and
  the camera.
- **Real QR flows** (`components/Qr.tsx`, jsQR): the hospital scans the patient's Kavach card, the paramedic scans
  the emergency QR, and the patient scans the UIDAI test Aadhaar QR (rendered as a downloadable card). Each works
  with the camera, a photo upload or a demo shortcut.
- **Lab + pharmacy** as real accounts (Anvil now runs with 12 accounts). They get minimum-necessary FHIR slices that
  are re-encrypted as separate records. A test confirms the pharmacy can't see the diagnosis.
- **Paramedic and Guardians** are separate roles. Each guardian signs in and releases their own share.
- **Under the hood** (`lib/trace.ts`, `components/Activity.tsx`): every crypto, IPFS, ZK and chain operation is
  logged live with tx hash, block, gas and sizes, and tagged *stays on device*, *leaves encrypted* or *public*.
- **Story mode** now shows a *How it works* column and the live log for each step (`H` toggles them).
- **Demo guide**: 11 cross-role steps, ticked from live chain state, each with a "sign in as …" button.

**Verification:** forge 31/31 · SDK 12/12 · nargo 2/2 · `roles.mjs` 16/16 + guide 11/11 · `story.mjs` 10/10 ·
`smoke.mjs --flow` (0 leaks) · `--attacks` 14/14 · `zcash.mjs` · CLI leak test PASS. `flows.mjs` was removed
because `roles.mjs` covers it through the role UI.

## 15. Round 4: Mohar, and a Story judges can watch

**Renamed Kavach → Mohar** (मोहर: an official seal, and a gold coin). The zero-knowledge proof is literally a seal
that certifies a claim, and the coin is the payout it triggers. New logo: a wax seal with a redaction bar. The UI,
docs, diagrams and pitch PDF (`pitch/Mohar-pitch.pdf`) are rebranded. Internal identifiers (`@kavach/sdk`, storage
keys, contract names) are unchanged on purpose.

**Scene view (`app/src/components/Scene.tsx`, framer-motion), now the default Story view:** one fixed 1280×520
canvas, scaled to fit, with hand-drawn SVG people, a phone, the "mohar press", a wax seal, coins and a public ledger.
Private rooms are violet and dashed; the public chain is teal and hatched. A new opening step, **"Today"**, shows the
file being copied to 4 readers, plus two sourced facts (the Sept 2024 leak of ~31M policyholders' records; ₹8–10k
crore/yr FWA, BCG × Medi Assist 2025). Every animation is driven by the real step:
- The press pumps while the browser proves.
- The 7 rules light up with the prover's real stages.
- Proof time and size are the real ones.
- Leak-scan rows come from the real chain scan.
- The fraud card shows the real spent nullifier.

Steps no longer auto-advance in scene view, so each animation can finish. `V` switches to the old device view.

**Checked:** `scene.mjs` (new, screenshots every scene) · `story.mjs` (device view) 10/10 · `roles.mjs` 16/16 ·
attacks 14/14.

## 16. Round 5: de-slop the UI

Researched what makes interfaces look AI-generated: serif + sans on beige, letter-spaced uppercase labels, cards
inside cards, rows of stat cards, coloured left-edge stripes, many accent colours cycling, pill badges everywhere,
icons before every heading, spring/bounce motion, dot-grid backgrounds. Kavach-era Mohar hit most of them.

New system, "clinical record" (`app/src/index.css`):
- **Type:** IBM Plex Sans for everything, Plex Mono only for hashes and keys.
- **Colour:** neutral off-white page, near-black ink. Green = valid/paid, red = blocked, ochre = waiting. The gold
  seal is the only brand accent. The old token names are remapped, so private/public no longer use extra hues.
- **Surfaces:** sections are separated by a hairline rule, not boxes. Stats are a statement row with a top rule.
  Radius is 5–6 px, with no drop shadows except menus. Empty states are plain text.
- **Navigation:** a text header with an underline for the active tab, and the role shown as "Patient Asha Verma ▾".
  The sign-in screen is a directory table instead of 16 cards.
- **Motion:** short ease-out, no springs, no pulsing. The Story scene uses neutral people and rooms.

Tests: `roles.mjs` 16/16 · `story.mjs` 10/10 · attacks 14/14. `smoke.mjs` and `roles.mjs` selectors were updated
for the new markup.

## 17. Round 6: MetaMask + role wallets + Base Sepolia

- **Role wallets:** `scripts/make-wallets.mjs` creates fresh keys (`.role-wallets.json`, gitignored). `demo.sh`
  funds each with 100 test ETH and deploys with the regulator's key. The seed writes `ROLE-WALLETS.local.md`
  (addresses, private keys, network) for MetaMask import. The patients keep their Aadhaar-bound wallets, because an
  Anon Aadhaar proof's signal is the wallet address. Hospital secrets, and so the staff keys, are now derived from the
  regulator key, so they stay stable across restarts.
- **MetaMask sign-in** (`app/src/lib/wallet.ts`):
  - Connect, then map each address to its role, then sign a one-time challenge.
  - Every contract call goes through a MetaMask signer. Gas is estimated on our RPC first, so a revert shows its
    reason before a pop-up appears.
  - Encryption (ECIES) keys and per-policy consent keys come from a deterministic `personal_sign`
    (`encryptionKeyFor` in the SDK). The seed registers those derived keys, so MetaMask and the demo keys agree.
  - Each tab can be a different MetaMask account.
  - Story, the Attack Lab and X-Ray force built-in keys. `?as=` links use demo wallets.
- **Base Sepolia:** a teammate's deploy settled a ₹73,800 claim there. It predates the derived keys and the lab and
  pharmacy roles, so `deploy-testnet.sh` now also makes Aadhaar proofs for the fresh patient keys. `run-testnet.sh`
  runs the API and app against the deployment, and tx hashes link to BaseScan.
- **Tested:**
  - `e2e/metamask.mjs`: a scripted EIP-1193 wallet, every role signs through MetaMask, 10/10, ~21 prompts.
  - `roles.mjs` 16/16 · `story.mjs` 10/10 · attacks 14/14 · forge 31/31 · SDK 12/12 · leak test PASS.

## 18. Round 7: live on Base Sepolia with MetaMask

Redeployed with the current code from a deployer holding only 0.001 ETH. The script's funding was sized to real
costs: the whole deploy is ~14M gas ≈ 0.00014 ETH at 0.006–0.01 gwei, and each role gets only what it needs.
`ClaimSettlement` is at `0x89f4C64836068f613183B58853491CE9ad7c2580`.

- **Patient Aadhaar proofs for the fresh testnet wallets.** Generating them was OOM-killed at 6.3 GB because
  snarkjs starts a worker per CPU. `sdk/scripts/few-cpus.cjs` caps it at 2 workers: ~55 s per proof.
- **Problems that only show up on a public network:**
  1. The RPC caps `eth_getLogs` at 200 blocks. The API now runs an **event indexer** (chunked catch-up, in memory),
     and the app routes every log query to it.
  2. Server-side filters (`contract.on`) aren't kept by load-balanced RPCs. Ghost Pay now polls in chunks.
  3. Stalled requests: ethers waits 5 min by default, which hung the indexer and therefore every history screen.
     Server and app now use 15 s timeouts with retries for transient errors, `/api/logs` never waits more than 1.5 s,
     and the API logs unhandled RPC errors instead of crashing.
  4. Lagging nodes return null for just-mined blocks and hand out stale nonces. The insurer desk tolerates nulls, and
     the relayer resets its nonce, retries, and polls for the receipt so a settled claim is never reported as failed.
  5. **Browser connection starvation:** Chrome allows ~6 connections per site across all tabs. Overlapping polls on
     a slow network starved new tabs. `useAsync` now never overlaps polls and pauses in hidden tabs, so a presenter
     can keep several role tabs open.
- **RPC:** switched to `base-sepolia-rpc.publicnode.com` (faster, no log-range cap).
- **Data isolation:** testnet data lives in `server/data-84532` and `.demo-84532.json`, so `demo.sh` can't wipe it.
  `sdk/scripts/renew-policy.ts` gives a demo patient a fresh, full policy after test claims use up her cover.
- **Tests:**
  - `e2e/metamask.mjs` **on Base Sepolia: 10/10**, every role signing through the scripted MetaMask.
  - Local: MetaMask 10/10 · roles 16/16 · story 10/10 · attacks 14/14.
