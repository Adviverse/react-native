// Expo config plugin: app.json → "plugins": [["@adviverse/react-native",
//   { "skadnetworkIds": ["xxxx.skadnetwork"], "userTrackingUsageDescription": "..." }]]
// Adds SKAdNetworkItems (deduped, case-insensitive) and NSUserTrackingUsageDescription.

function applyIosPlist(plist, props) {
  const out = Object.assign({}, plist);
  const ids = (props && props.skadnetworkIds) || [];
  if (ids.length) {
    const items = Array.isArray(out.SKAdNetworkItems) ? out.SKAdNetworkItems.slice() : [];
    const have = new Set(items.map((i) => String(i.SKAdNetworkIdentifier || '').toLowerCase()));
    for (const id of ids) {
      const v = String(id).trim().toLowerCase();
      if (v && !have.has(v)) { items.push({ SKAdNetworkIdentifier: v }); have.add(v); }
    }
    out.SKAdNetworkItems = items;
  }
  if (props && props.userTrackingUsageDescription) out.NSUserTrackingUsageDescription = props.userTrackingUsageDescription;
  return out;
}

function withAdviverse(config, props) {
  const { withInfoPlist } = require('expo/config-plugins');
  return withInfoPlist(config, (c) => {
    c.modResults = applyIosPlist(c.modResults, props || {});
    return c;
  });
}

module.exports = withAdviverse;
module.exports.applyIosPlist = applyIosPlist;
