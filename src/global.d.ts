declare const snap: {
  request: <Result = unknown>(args: { method: string; params?: unknown }) => Promise<Result>;
};
