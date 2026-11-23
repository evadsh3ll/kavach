// snarkjs starts one worker per CPU and each holds a copy of the proving data; on an 8 GB laptop that OOMs.
// Preload this (NODE_OPTIONS="--require …/few-cpus.cjs") to cap it at 2 workers: ~1 min per Anon Aadhaar proof.
const os = require('os');
const real = os.cpus;
os.cpus = () => real().slice(0, Number(process.env.PROVER_THREADS ?? 2));
