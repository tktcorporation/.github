import { defineBuildConfig } from "unbuild";
import pkg from "./package.json";

export default defineBuildConfig({
  entries: ["src/index"],
  clean: true,
  declaration: false,
  rollup: {
    emitCJS: false,
    replace: {
      preventAssignment: true,
      values: {
        __VERSION__: JSON.stringify(pkg.version),
      },
    },
  },
});
