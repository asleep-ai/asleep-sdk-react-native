import { registerRootComponent } from "expo";

import App from "./App";

// expo/AppEntry.js imports "../../App" relative to its own location, which breaks
// when pnpm's hoisted layout places expo in the repository-root node_modules.
registerRootComponent(App);
