const HtmlWebpackPlugin = require("html-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const { CleanWebpackPlugin } = require("clean-webpack-plugin");
const webpack = require("webpack");
const path = require("path");

const deleteAccountUrl = process.env.DELETE_ACCOUNT_PUBLIC_URL || "";
const webAppApiBaseUrl =
  process.env.VIDEO_BACKEND_BASE_URL || process.env.CTA_API_BASE_URL || "";

function serializeInlineJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function buildStaticSharedFeedShellHtml({
  route,
  routeKey,
  title,
  description,
  eyebrow,
  headline,
  supportingCopy,
  requiresAuth = false,
}) {
  const runtimeConfig = {
    brandName: "Polis",
    route,
    routeKey,
    routeParams: {},
    requiresAuth,
    requestUrl: "",
    canonicalUrl: "",
    publicWebBaseUrl: process.env.PUBLIC_WEB_BASE_URL || "",
    apiBaseUrl: webAppApiBaseUrl,
    appUrlScheme:
      process.env.APP_URL_SCHEME ||
      process.env.STRIPE_RETURN_URL_SCHEME ||
      "myapp",
    iosStoreUrl: process.env.CTA_IOS_STORE_URL || "",
    androidStoreUrl: process.env.CTA_ANDROID_STORE_URL || "",
    auth: {
      region: process.env.COGNITO_REGION || "",
      clientId: process.env.COGNITO_APP_CLIENT_ID || "",
      domain: process.env.COGNITO_DOMAIN || "",
      scopes: process.env.COGNITO_SCOPES || "",
      enablePasswordFlow: process.env.COGNITO_ENABLE_PASSWORD_FLOW || "false",
      redirectUri: process.env.COGNITO_REDIRECT_URI || "",
    },
    map: {
      styleUrl: process.env.VOTER_MAP_STYLE_URL || "",
      maptilerApiKey: process.env.MAPTILER_API_KEY || "",
    },
    stripe: {
      publishableKey:
        process.env.STRIPE_PUBLISHABLE_KEY ||
        process.env.STRIPE_PUBLIC_KEY ||
        "",
    },
    messaging: {
      wsUrl:
        process.env.MESSAGING_WS_URL || process.env.MESSAGING_GATEWAY_URL || "",
    },
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <title>${title}</title>
  </head>
  <body>
    <div id="shared-feed-app">
      <div class="shared-feed-shell-fallback">
        <div class="shared-feed-shell-fallback__card">
          <p class="shared-feed-shell-fallback__eyebrow">${eyebrow}</p>
          <h1>${headline}</h1>
          <p>${supportingCopy}</p>
          <div class="shared-feed-shell-fallback__actions">
            <button class="shared-feed-shell-fallback__button shared-feed-shell-fallback__button--primary" type="button">Loading...</button>
          </div>
        </div>
      </div>
    </div>
    <script>
      window.__POLIS_WEB_APP__ = ${serializeInlineJson(runtimeConfig)};
      window.__POLIS_SHARED_FEED__ = window.__POLIS_WEB_APP__;
    </script>
  </body>
</html>`;
}

function staticElectionDayShell(filename) {
  return new HtmlWebpackPlugin({
    templateContent: buildStaticSharedFeedShellHtml({
      route: "/election-day",
      routeKey: "election-day",
      title: "Election Day | Polis",
      description:
        "Track live and finalized election results in Polis.",
      eyebrow: "Election Day",
      headline: "Live election results",
      supportingCopy:
        "Follow race results, district maps, reporting status, and called winners from the browser.",
      requiresAuth: false,
    }),
    filename,
    chunks: ["shared-feed"],
    favicon: "./src/assets/images/polis/Polis.png",
  });
}

function staticCtaInviteShell(filename) {
  return new HtmlWebpackPlugin({
    templateContent: buildStaticSharedFeedShellHtml({
      route: "/cta-invite",
      routeKey: "cta-invite",
      title: "CTA Invitation | Polis",
      description:
        "Preview and accept a coalition call-to-action invitation in Polis.",
      eyebrow: "CTA Invitation",
      headline: "Opening your invitation",
      supportingCopy:
        "Review event details, sign in, and accept your coalition invitation from the browser.",
      requiresAuth: false,
    }),
    filename,
    chunks: ["shared-feed"],
    favicon: "./src/assets/images/polis/Polis.png",
  });
}

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
  __CTA_API_BASE_URL__: JSON.stringify(process.env.CTA_API_BASE_URL || ""),
  __CTA_IOS_STORE_URL__: JSON.stringify(process.env.CTA_IOS_STORE_URL || ""),
  __CTA_ANDROID_STORE_URL__: JSON.stringify(
    process.env.CTA_ANDROID_STORE_URL || "",
  ),
  __CTA_APP_DEEP_LINK_BASE_URL__: JSON.stringify(
    process.env.CTA_APP_DEEP_LINK_BASE_URL || "",
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
    "shared-feed": "./src/pages/shared-feed/shared-feed.js",
    notFound: "./src/pages/404/404.js",
  },
  output: {
    path: path.resolve(__dirname, "dist"),
    filename: (pathData) =>
      pathData.chunk?.name === "shared-feed"
        ? "scripts/shared-feed.js"
        : "scripts/[name].[contenthash].js",
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
      filename: (pathData) =>
        pathData.chunk?.name === "shared-feed"
          ? "css/shared-feed.css"
          : "css/[name].[contenthash].css",
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
    staticCtaInviteShell("cta-invite/index.html"),
    new HtmlWebpackPlugin({
      template: "./src/pages/404/404.html",
      filename: "404.html",
      chunks: ["main", "notFound"],
      publicPath: "/",
      favicon: "./src/assets/images/polis/Polis.png",
    }),
    staticElectionDayShell("election-day.html"),
    staticElectionDayShell("election-day/index.html"),
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
