export function returnFromStartMenu({ closeMenu, returnToMenu, onSaveFailure }) {
  closeMenu();
  if (returnToMenu()) return true;
  onSaveFailure();
  return false;
}

export async function quitFromStartMenu({
  closeMenu,
  hasSave,
  save,
  quitApp,
  closeWindow,
  onSaveFailure,
  onQuitFailure,
}) {
  closeMenu();
  if (hasSave && !save()) {
    onSaveFailure();
    return false;
  }
  try {
    if (quitApp) await quitApp();
    else closeWindow();
    return true;
  } catch (error) {
    onQuitFailure(error);
    return false;
  }
}
