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
