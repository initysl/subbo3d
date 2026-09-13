import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Functions whose results are implementation-approximated in ECMAScript.
 *
 * Two engines may return different bits for the same argument, which would
 * silently desynchronise replays and online lockstep. The simulation does not
 * need any of them: aim arrives as a vector rather than an angle, so
 * normalisation needs only `sqrt`, and rotation is a rendering concern.
 */
const NON_DETERMINISTIC_MATH = [
  "sin", "cos", "tan", "asin", "acos", "atan", "atan2",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "exp", "expm1", "log", "log2", "log10", "log1p",
  "pow", "hypot", "cbrt", "fround", "random",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    // The determinism boundary. Everything inside it must produce bit-identical
    // results on every machine, so this is enforced by the build rather than by
    // discipline — a single stray Math.sin here would break online play months
    // later, in a way that is very hard to trace back.
    files: ["lib/sim/**/*.ts", "lib/rules/**/*.ts", "lib/match/**/*.ts"],
    rules: {
      "no-restricted-properties": [
        "error",
        ...NON_DETERMINISTIC_MATH.map((property) => ({
          object: "Math",
          property,
          message:
            "Implementation-approximated in ECMAScript, so results can differ between engines. Not permitted inside the determinism boundary.",
        })),
      ],
      "no-restricted-globals": [
        "error",
        { name: "window", message: "The simulation must not touch the DOM." },
        { name: "document", message: "The simulation must not touch the DOM." },
        {
          name: "performance",
          message: "The simulation's only clock is its step counter.",
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='**']",
          message: "The ** operator is Math.pow, which is implementation-approximated.",
        },
        {
          selector: "NewExpression[callee.name='Date']",
          message: "The simulation's only clock is its step counter.",
        },
        {
          selector: "CallExpression[callee.object.name='Date']",
          message: "The simulation's only clock is its step counter.",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["three", "three/*", "@/lib/render", "@/lib/render/*"],
              message:
                "The simulation must not depend on the renderer. Dependencies point one way only.",
            },
          ],
        },
      ],
    },
  },

  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
