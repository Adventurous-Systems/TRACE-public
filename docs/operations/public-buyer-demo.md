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
delay. The command holds a PostgreSQL advisory lock and keeps each of the
seven catalogue products at exactly one passport and one lot:

- A lot on sale with fewer units available than its catalogue lot size is
  restocked in place: its quantity and available units rise by the
  difference, so its orders and history are unchanged.
- A lot that was delisted (cancelled or expired) is listed again on the same
  passport.
- A lot fully held by open orders, or sold out, is reported and left alone.
- A passport is created only for a product that has none at all.

It never deletes or changes visitor data. `--target-active` is still accepted
for the installed timer, and must be 1.

Each product has one passport (owner, 2026-10-21). Older deployments kept a
product's earlier lots as spare passports whose listings were cancelled. To
delete them, preview and then run, through the trusted wrapper:

    demo-retire-spares --env demo --dry-run
    demo-retire-spares --env demo --yes

It keeps each product's lot on sale (or, when none is, its lowest-numbered
passport) and deletes every other curated passport that nothing depends on:
no order, history event, quality report or sensor reading, and no listing
other than a cancelled or expired one. Anything else is reported and left
alone. Deleting a passport removes its listings and events; the audit and
chain-transaction records are kept, and the spare's QR code stays in the
write-once file store. Take a database backup first. `demo-verify` and the
invariant check warn while a product has more than one passport; they don't
fail, so a deploy can still pass before this has run.

`demo-trim-active` converges an older multi-lot deployment's listings:

    demo-trim-active --env demo --target-active 1 --dry-run
    demo-trim-active --env demo --target-active 1 --yes

It cancels only surplus active listings whose passports carry the curated seed marker, a known catalogue key, and a valid demo lot number. The lowest-numbered lot remains active. Transaction-linked, reserved, sold, unmarked, and visitor data remain untouched. Its cancelled lots become spares for `demo-retire-spares`. The trim, retirement and replenishment commands share one PostgreSQL advisory lock.

Keep secrets in /var/lib/trace-demo/secrets, mutable non-secret configuration in /var/lib/trace-demo/config, mutable deployment state in /var/lib/trace-demo/state, bind-mounted data in /var/lib/trace-demo/data, immutable releases in /opt/trace-public-demo/releases, and only static nginx/systemd material in /etc.

## Orders on the demo

The same order rules apply as anywhere else, with one addition for this
profile:

- **A curated lot keeps its last unit.** One order may take a curated lot's
  stock less one, so a visitor can't take a product off the demo marketplace.
  With one left, the listing says so and offers no order form. Lots that are
  not curated, and other profiles, are unaffected.
- **Time limits.** Nobody answers a visitor's order on the demo, so it lapses
  after 72 hours and its quantity returns to the lot. An accepted order
  completes when its 48-hour window to report a problem closes. The sweep runs
  every minute in the API process, so it needs no worker; the same rule is
  applied whenever an order is read or acted on.
- **Reported problems** wait for the platform admin on Flagged orders, who
  decides whether the sale stands or the order is cancelled (the stock
  returns), with a reason both sides read.
- **Expiry.** A listing past its date leaves the marketplace at once and takes
  no new orders; the sweep marks it expired once its open orders close. An
  expiry date lasts to the end of that day, UK time.

## Visitor-facing guidance

The landing page and marketplace show a "What to try" panel
(components/DemoGuide.tsx), visible only under public_buyer_demo: browse the
marketplace, open a listing and its passport, click "Verify integrity" to see
the fingerprint recompute live, then create a free account to order at the asking price.
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
reclaimed-by, unit of measure, origin and deconstruction method. It never
changes lot numbers, grades or photos. A name changes only when it is one
the catalogue has superseded (`SUPERSEDED_PRODUCT_NAMES` in `catalogue.ts`),
keeping a lot's "— Demo Lot NNN"; a deconstruction date is only ever cleared,
for a product the catalogue says was never deconstructed. A condition note
changes only when it still reads exactly as an earlier catalogue seeded it
(`SUPERSEDED_CONDITION_NOTES`); a note anyone edited stays. It also gives an
original curated passport its catalogue key, so every release finds it
whatever its name.
Each line of its output says whether the passport's fingerprint changes.
Origin, unit and key are not in the fingerprint, so those corrections leave
the anchor as it is. Anchored passports whose fingerprint changes are marked
pending, and the anchor worker re-anchors them within one sweep (about 5
minutes). After a rollback window, run it again: the previous release tops up
lots with its own catalogue. Unlike `demo:restore`,
it is safe on the public demo.
