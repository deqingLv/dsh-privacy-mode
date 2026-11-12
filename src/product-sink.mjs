// A zero-transport replacement for the disabled desktop product exporter.
// Keeping productTelemetry present lets the official productAnalytics remote
// return false rather than failing its dependency injection. No record is retained.
export function apply(ctx, config = {}) {
  if (config && Object.keys(config).length) throw new Error('dsh-privacy-mode/product-sink accepts no options');
  ctx.provide('productTelemetry', Object.freeze({
    privacyModeSink: true,
    emit(_record) {},
  }));
}
export default { name: 'privacy-mode-product-sink', apply };
