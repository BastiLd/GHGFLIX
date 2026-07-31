import { registerRootComponent } from "expo";

// Beim Bau mit dem Profil "diagnose" (EXPO_PUBLIC_DIAGNOSE=1) startet statt der
// normalen App eine abgespeckte Diagnose-Fassung. Sie importiert am Anfang
// NICHTS ausser React Native und prueft die Zusatzmodule erst nach dem ersten
// Bild - so laesst sich am Fernseher ablesen, welcher Baustein Aerger macht,
// ganz ohne PC und ohne adb.
const istDiagnose = process.env.EXPO_PUBLIC_DIAGNOSE === "1";

const App = istDiagnose ? require("./App.diagnose").default : require("./App").default;

registerRootComponent(App);
