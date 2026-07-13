// Shared dynamic imports that can be warmed during idle time before the user
// needs them. Keep the import() specifier in one place so callers and
// preloaders always hit the same chunk.
export const preloadLoaders = {
  qrcode: () => import('qrcode'),
} as const;

export const qrcodeLoader = preloadLoaders.qrcode;