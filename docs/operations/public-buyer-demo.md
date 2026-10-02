# Public buyer demo operations

public_buyer_demo is the deployment profile for demo.trace.adventurous.systems.
It permits anonymous marketplace browsing, buyer registration, login, and buyer
marketplace actions. Existing role checks continue to block seller, passport,
quality, and administrative mutations for new public users.

The public demo retains visitor accounts, offers, transactions, reserved lots,
and sold lots. It is not a disposable reset environment. Never schedule
demo:restore against it: that legacy command cancels and removes curated
transaction history.

Run replenishment through the trusted wrapper. It holds the deployment lock and resolves exactly one immutable active environment file before invoking the operations image:

    /usr/local/libexec/trace-demo/run-replenish.sh /var/lib/trace-demo/config/active.env

The timer template runs this at 02:15 Africa/Johannesburg with a randomized
delay. The command holds a PostgreSQL advisory lock, counts active lots only,
and tops up each of the seven catalogue products to one active listing.
New lots are independently numbered, serialized, photographed, and tagged with
catalogueKey, catalogueName, demoLotNumber, demoBatch, and the curated
seed-source marker. It never deletes or changes visitor data.

To converge an older multi-lot deployment, first preview and then run the guarded trim command through the exact operations image:

    demo-trim-active --env demo --target-active 1 --dry-run
    demo-trim-active --env demo --target-active 1 --yes

It cancels only surplus active listings whose passports carry the curated seed marker, a known catalogue key, and a valid demo lot number. The lowest-numbered lot remains active. Transaction-linked, reserved, sold, unmarked, and visitor data remain untouched. The trim and replenishment commands share one PostgreSQL advisory lock.

Keep secrets in /var/lib/trace-demo/secrets, mutable non-secret configuration in /var/lib/trace-demo/config, mutable deployment state in /var/lib/trace-demo/state, bind-mounted data in /var/lib/trace-demo/data, immutable releases in /opt/trace-public-demo/releases, and only static nginx/systemd material in /etc.

## Visitor-facing guidance

The landing page and marketplace show a "What to try" panel
(components/DemoGuide.tsx), visible only under public_buyer_demo: browse the
marketplace, open a listing and its passport, click "Verify integrity" to see
the fingerprint recompute live, then create a free account to make an offer.
The register page's demo banner states what an account is for, and the
marketplace's empty state distinguishes "no results for these filters" (with
a clear-filters action) from "no listings are active right now" (attributed
to replenishment catching up, without naming a specific cadence — keep this
copy in sync if the replenishment schedule above changes).

Keep this copy honest about what the demo actually does — in particular,
never describe the simulated trust-layer fingerprint as a live VeChain
anchor (see .env.example's DEMO_SIMULATE_ANCHOR comment).

## Thor Solo block production

The demo's Thor Solo node should write a block only when there is a
transaction to include, so an idle demo does not grow the chain data
directory. From Thor v2.4, `--on-demand` alone does not do this. Solo still
packs an empty block every `--block-interval` seconds (default 10), which
came to about 8,600 empty blocks a day. `--on-demand` still packs a block as
soon as a transaction arrives. So both Compose files run:

    solo --on-demand --block-interval 86400 --persist ...

Measured with `vechain/thor:v2.4.3` and this repository's `genesis.json`:

- no new blocks during idle periods;
- a transaction included about 0.1 s after submission;
- one extra block at each node restart, from Solo's own startup transaction;
- one empty block a day at most.

The long interval only affects Solo. Testnet and mainnet nodes follow the
network's own block schedule.

## On-chain anchoring

The demo anchors passport fingerprints on its own Thor Solo chain, which is
not reachable from the internet. Visitors check an anchor inside the app. A
publicly checkable chain (VeChain testnet) is a later step, and it is a
configuration change rather than new code.

Each deployment has its own chain identity: a deployer key and a genesis that
funds only that key. Never reuse a key across deployments or commit one to
this repository.

Bringing it up, as root on the demo host (`<sha>` is the live release):

1.  **Create the chain identity** in a root-only directory, using the
    release's API image:

        install -d -m 700 /var/lib/trace-demo/config/chain
        docker run --rm --user 0 -v /var/lib/trace-demo/config/chain:/out \
          trace-demo-api:<sha> node dist/scripts/solo-genesis.js /out

    This writes `deployer.key` (mode 600, never printed) and `genesis.json`.
    It refuses to overwrite either file.

2.  **Reset the chain onto the new genesis.** Stop `thor-solo`, move its data
    directory aside as a backup, and point the Compose file's genesis at the
    new file. Start it again, then confirm the node answers and that idle
    periods add no blocks (see "Thor Solo block production").
3.  **Deploy the registry:**

        /usr/local/libexec/trace-demo/run-ops.sh /var/lib/trace-demo/config/active.env chain-deploy-registry

    It prints `MATERIAL_REGISTRY_ADDRESS=...`. It refuses if an address is
    already configured, unless `--force` is passed.

4.  **Configure the API environment file** (mode 600):
    - `MATERIAL_REGISTRY_ADDRESS` from step 3;
    - `DEPLOYER_PRIVATE_KEY` and `FEE_DELEGATOR_PRIVATE_KEY`, both set to the
      deployer key. Organisation wallets hold no VTHO, so the deployer
      sponsors their gas;
    - `FEE_DELEGATION_REQUIRED=true`;
    - `WALLET_ENCRYPTION_KEY`, a new random secret;
    - `CHAIN_NETWORK_LABEL`, describing the chain honestly (e.g. "TRACE demo
      chain (VeChain Thor Solo)").
5.  **Enable the anchor worker:** set `TRACE_ENABLE_WORKER=1` in the live
    deploy environment. Every later deploy carries it forward, and
    `switch-worker.sh` keeps the worker on the live slot.
6.  **Switch anchoring on:** set `DEMO_SIMULATE_ANCHOR=false` and deploy. The
    worker's sweep then anchors every passport that has a fingerprint but no
    chain transaction, including the curated catalogue, within about five
    minutes.

To go back to simulation, set `DEMO_SIMULATE_ANCHOR=true` and redeploy. The
site never depends on the chain in simulation mode.

## Correcting the curated catalogue

When a catalogue product's descriptive data is wrong (for example its
category), fix it in `packages/db/scripts/lib/catalogue.ts`. New lots then get
the corrected values. To correct the passports and lots that already exist,
without touching visitor data, run:

    /usr/local/libexec/trace-demo/run-ops.sh /var/lib/trace-demo/config/active.env demo-correct-catalogue --env demo --dry-run
    /usr/local/libexec/trace-demo/run-ops.sh /var/lib/trace-demo/config/active.env demo-correct-catalogue --env demo --yes

It changes only the allowlisted fields in
`scripts/lib/catalogue-corrections.ts`: category, subcategory,
reclaimed-by and unit of measure. It never changes names, lot numbers, grades, notes or photos.
Anchored passports it corrects are marked pending, and the anchor worker
re-anchors them within one sweep (about 5 minutes). Unlike `demo:restore`,
it is safe on the public demo.
