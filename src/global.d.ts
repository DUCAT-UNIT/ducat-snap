declare const snap: {
  request: <T = unknown>(args: { method: string; params?: unknown }) => Promise<T>;
};
