function createQuitHandler(policy, app) {
  return (event) => {
    if (!policy.trustedSender(event)) return false;
    app.quit();
    return true;
  };
}

module.exports = { createQuitHandler };
