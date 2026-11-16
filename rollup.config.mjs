import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";

export default {
	input: "src/plugin.js",
	output: {
		file: "com.foxy.magicqdeck.sdPlugin/bin/plugin.js",
		format: "esm",
		sourcemap: false,
	},
	plugins: [nodeResolve({ preferBuiltins: true, exportConditions: ["node"] }), commonjs()],
};
