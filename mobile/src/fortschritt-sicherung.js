/** Ein pausiertes Geraet darf keinen neueren Fortschritt anderer Geraete
 * alle zehn Sekunden mit seiner unveraenderten Position ueberschreiben. */
export function erzeugeFortschrittsSicherung(schreiben) {
  let zuletzt = null;
  return async (daten) => {
    const stand = JSON.stringify(daten);
    if (stand === zuletzt) return false;
    zuletzt = stand;
    try { await schreiben(daten); return true; }
    catch {
      // Ein fehlgeschlagener Stand muss erneut gesendet werden koennen;
      // ein spaeterer erfolgreicher Stand darf dabei nicht verloren gehen.
      if (zuletzt === stand) zuletzt = null;
      return false;
    }
  };
}
