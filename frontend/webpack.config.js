const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const webpack = require("webpack");
const path = require("path");

const deleteAccountUrl = process.env.DELETE_ACCOUNT_PUBLIC_URL || "";
const deleteAccountDefineEnv = {
  __DELETE_ACCOUNT_API_BASE_URL__: JSON.stringify(
    process.env.DELETE_ACCOUNT_API_BASE_URL || "",
  ),
  __COGNITO_REGION__: JSON.stringify(process.env.COGNITO_REGION || ""),
  __COGNITO_APP_CLIENT_ID__: JSON.stringify(
    process.env.COGNITO_APP_CLIENT_ID || "",
  ),
  __COGNITO_DOMAIN__: JSON.stringify(process.env.COGNITO_DOMAIN || ""),
  __COGNITO_REDIRECT_URI__: JSON.stringify(
    process.env.COGNITO_REDIRECT_URI || "",
  ),
  __COGNITO_SCOPES__: JSON.stringify(process.env.COGNITO_SCOPES || ""),
  __COGNITO_ENABLE_PASSWORD_FLOW__: JSON.stringify(
    process.env.COGNITO_ENABLE_PASSWORD_FLOW || "false",
  ),
};

module.exports = {
  mode: "production",
  entry: {
    main: "./src/main.js",
    index: "./src/pages/index/index.js",
    features: "./src/pages/features/features.js",
    about: "./src/pages/about/about.js",
    faq: "./src/pages/faq/faq.js",
    contact: "./src/pages/contact/contact.js",
    terms: "./src/pages/terms/terms.js",
    privacyPolicy: "./src/pages/privacy-policy/privacy-policy.js",
    dataSafety: "./src/pages/data-safety/data-safety.js",
    childSafety: "./src/pages/child-safety/child-safety.js",
    deleteAccount: "./src/pages/delete-account/delete-account.js",
    notFound: "./src/pages/404/404.js",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: "scripts/[name].[contenthash].js",
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, "css-loader"],
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: "babel-loader",
          options: {
            presets: ["@babel/preset-env"],
          },
        },
      },
      {
        test: /\.(png|jpg|gif|mp4)$/,
        type: "asset/resource",
        generator: {
          filename: "assets/[name][ext]",
        },
      },
      {
        test: /\.html$/,
        exclude: [
          path.resolve(
            __dirname,
            "src/pages/privacy-policy/privacy-policy.html",
          ),
          path.resolve(__dirname, "src/pages/data-safety/data-safety.html"),
        ],
        use: ["html-loader"],
      },
      {
        test: /\.md$/,
        use: "raw-loader",
      },
    ],
  },
  plugins: [
    new CleanWebpackPlugin(),
    new MiniCssExtractPlugin({
      filename: "css/[name].[contenthash].css",
    }),
    new webpack.DefinePlugin(deleteAccountDefineEnv),
    new HtmlWebpackPlugin({
      template: "./src/components/header/header.html",
      filename: "header.html",
    }),
    new HtmlWebpackPlugin({
      template: "./src/components/footer/footer.html",
      filename: "footer.html",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/index/index.html",
      filename: "index.html",
      chunks: ["main", "index"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/features/features.html",
      filename: "features.html",
      chunks: ["main", "features"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/about/about.html",
      filename: "about.html",
      chunks: ["main", "about"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/faq/faq.html",
      filename: "faq.html",
      chunks: ["main", "faq"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/contact/contact.html",
      filename: "contact.html",
      chunks: ["main", "contact"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/terms/terms.html",
      filename: "terms.html",
      chunks: ["main", "terms"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/privacy-policy/privacy-policy.html",
      filename: "privacy-policy.html",
      chunks: ["main", "privacyPolicy"],
      favicon: "./src/assets/images/polis/Polis.png",
      templateParameters: {
        deleteAccountUrl,
      },
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/data-safety/data-safety.html",
      filename: "data-safety.html",
      chunks: ["main", "dataSafety"],
      favicon: "./src/assets/images/polis/Polis.png",
      templateParameters: {
        deleteAccountUrl,
      },
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/child-safety/child-safety.html",
      filename: "child-safety.html",
      chunks: ["main", "childSafety"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/delete-account/delete-account.html",
      filename: "delete-account.html",
      chunks: ["main", "deleteAccount"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    new HtmlWebpackPlugin({
      template: "./src/pages/404/404.html",
      filename: "404.html",
      chunks: ["main", "notFound"],
      favicon: "./src/assets/images/polis/Polis.png",
    }),
  ],
  devServer: {
    proxy: [
      {
        context: ["/api", "/graphql", "/uploads"],
        target: "http://localhost:3000",
        changeOrigin: true,
        secure: false,
      },
    ],
    static: {
      directory: path.join(__dirname, "dist"),
    },
    compress: true,
    port: 9000,
    allowedHosts: "all",
  },
};

console.log("Webpack output path:", path.resolve(__dirname, "dist"));
console.log("Entry points:", module.exports.entry);
