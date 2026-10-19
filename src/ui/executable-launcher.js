export function createExecutableLauncher(handlers) {
  return (applicationId, file, fileId) => {
    const launch = handlers[applicationId];
    return typeof launch === 'function' ? launch(file, fileId) : undefined;
  };
}
