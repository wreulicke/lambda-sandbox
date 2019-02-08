"use strict"
import * as path from "path"

import * as webpack from "webpack"

const config: webpack.Configuration = {
  devtool: "source-map",
  entry: "./index.ts",
  output: {
    path: path.resolve("./target"),
    filename: "index.js",
    libraryTarget: "commonjs2",
  },
  target: "node",
  resolve: {
    extensions: [".json", ".tsx", ".ts", ".js"]
  },
  plugins: [
    // new webpack.optimize.UglifyJsPlugin()
  ],
  module: {
    rules: [
      {
        test: /\.jsx?$/,
        use: [
          {
            loader: "babel-loader",
          },
        ],
      },
      {
        test: /\.ts?$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader",
          },
        ],
      },
    ],
  },
}

module.exports = config