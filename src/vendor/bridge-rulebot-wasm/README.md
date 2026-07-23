# bridge-rulebot-wasm (vendored build)

Generated — do not edit. Built from `../../../bridge-rulebot/wasm` with:

    cd bridge-rulebot/wasm && wasm-pack build --target web --release
    cp pkg/bridge_rulebot_wasm{.js,_bg.wasm,.d.ts,_bg.wasm.d.ts} pkg/package.json \
       ../../Bridge-Classroom/src/vendor/bridge-rulebot-wasm/

Vendored (not a `file:` npm dep) so `npm ci` in CI needs no sibling checkout.
Re-run the above whenever the bridge-rulebot core changes.
