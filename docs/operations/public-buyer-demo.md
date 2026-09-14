# Public buyer demo operations

public_buyer_demo is the deployment profile for demo.trace.adventurous.systems.
It permits anonymous marketplace browsing, buyer registration, login, and buyer
marketplace actions. Existing role checks continue to block seller, passport,
quality, and administrative mutations for new public users.

The public demo retains visitor accounts, offers, transactions, reserved lots,
and sold lots. It is not a disposable reset environment. Never schedule
demo:restore against it: that legacy command cancels and removes curated
transaction history.

Run replenishment through the immutable operations image:

    run-ops.sh /var/lib/trace-demo/config/active.env demo-replenish \
      --env demo --target-active 3 --yes

The timer template runs this at 02:15 Africa/Johannesburg with a randomized
delay. The command holds a PostgreSQL advisory lock, counts active lots only,
and tops up each of the seven catalogue products to three active listings.
New lots are independently numbered, serialized, photographed, and tagged with
catalogueKey, catalogueName, demoLotNumber, demoBatch, and the curated
seed-source marker. It never deletes or changes visitor data.

Keep secrets in /var/lib/trace-demo/secrets, non-secret release configuration
in /var/lib/trace-demo/config, immutable releases in
/opt/trace-public-demo/releases, and only nginx/systemd material in /etc.
