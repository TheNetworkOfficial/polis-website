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
  routeParams = {},
}) {
  const runtimeConfig = {
    brandName: "Polis",
    route,
    routeKey,
    routeParams,
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
    publicPath: "/",
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
    publicPath: "/",
    favicon: "./src/assets/images/polis/Polis.png",
  });
}

function staticSettingsVoterIntelligenceShell(filename) {
  return new HtmlWebpackPlugin({
    templateContent: buildStaticSharedFeedShellHtml({
      route: "/settings/voter-intelligence",
      routeKey: "settings-section",
      routeParams: { settingsPath: "voter-intelligence" },
      title: "Voter Intelligence | Polis",
      description:
        "Review voter intelligence, district elections, ballot-guide progress, and policy questions in Polis.",
      eyebrow: "Voter Intelligence",
      headline: "Opening your ballot profile",
      supportingCopy:
        "Track matrix confidence, district races, saved rankings, and ballot-guide readiness from the browser.",
      requiresAuth: true,
    }),
    filename,
    chunks: ["shared-feed"],
    publicPath: "/",
    favicon: "./src/assets/images/polis/Polis.png",
  });
}

function staticMessagesShell(filename) {
  return new HtmlWebpackPlugin({
    templateContent: buildStaticSharedFeedShellHtml({
      route: "/messages",
      routeKey: "messages-root",
      title: "Messages | Polis",
      description:
        "Open direct messages, campaign rooms, coalition channels, and secure conversation settings in Polis.",
      eyebrow: "Messages",
      headline: "Opening your conversations",
      supportingCopy:
        "Review direct messages, group threads, rooms, mentions, attachments, and secure messaging controls from the browser.",
      requiresAuth: true,
    }),
    filename,
    chunks: ["shared-feed"],
    publicPath: "/",
    favicon: "./src/assets/images/polis/Polis.png",
  });
}

function staticCandidateDashboardShell(filename) {
  return new HtmlWebpackPlugin({
    templateContent: buildStaticSharedFeedShellHtml({
      route: "/candidate-dashboard",
      routeKey: "candidate-dashboard",
      title: "Candidate Dashboard | Polis",
      description:
        "Open campaign analytics, calendar, voter registry, mission tools, events, donations, staff access, and voter-map workflows in Polis.",
      eyebrow: "Candidate Dashboard",
      headline: "Opening your campaign workspace",
      supportingCopy:
        "Manage candidate profile work, campaign analytics, voter outreach, events, donations, staff roles, missions, and calendar planning from the browser.",
      requiresAuth: true,
    }),
    filename,
    chunks: ["shared-feed"],
    publicPath: "/",
    favicon: "./src/assets/images/polis/Polis.png",
  });
}

function staticCoalitionsShell(filename) {
  return new HtmlWebpackPlugin({
    templateContent: buildStaticSharedFeedShellHtml({
      route: "/coalitions",
      routeKey: "coalitions",
      title: "Coalitions | Polis",
      description:
        "Open coalition home, membership, admin, missions, voter-map, events, amplification, constitution, and voting tools in Polis.",
      eyebrow: "Coalitions",
      headline: "Opening your coalition workspace",
      supportingCopy:
        "Create, join, manage, and coordinate coalitions with members, roles, voter-map work, missions, amplification, events, proposals, and votes from the browser.",
      requiresAuth: true,
    }),
    filename,
    chunks: ["shared-feed"],
    publicPath: "/",
    favicon: "./src/assets/images/polis/Polis.png",
  });
}

function staticSharedAppShell(
  filename,
  {
    route,
    routeKey = "",
    routeParams = {},
    title,
    description,
    eyebrow,
    headline,
    supportingCopy,
    requiresAuth = true,
  },
) {
  return new HtmlWebpackPlugin({
    templateContent: buildStaticSharedFeedShellHtml({
      route,
      routeKey,
      routeParams,
      title,
      description,
      eyebrow,
      headline,
      supportingCopy,
      requiresAuth,
    }),
    filename,
    chunks: ["shared-feed"],
    publicPath: "/",
    favicon: "./src/assets/images/polis/Polis.png",
  });
}

const sharedAppShells = [
  {
    filename: "feed/index.html",
    route: "/feed",
    routeKey: "feed",
    title: "Feed | Polis",
    description: "Open the Polis web feed for posts, civic updates, and shared community media.",
    eyebrow: "Feed",
    headline: "Opening your feed",
    supportingCopy:
      "Watch posts, read civic updates, and continue into the signed-in Polis web experience.",
  },
  {
    filename: "posts/index.html",
    route: "/posts",
    title: "Post | Polis",
    description: "Open a shared Polis post, comments, and related civic context in the browser.",
    eyebrow: "Shared Post",
    headline: "Opening this post",
    supportingCopy:
      "Load the shared post, comments, profile context, and app handoff options from the browser.",
    requiresAuth: false,
  },
  {
    filename: "create/index.html",
    route: "/create",
    routeKey: "create",
    title: "Create | Polis",
    description: "Open Polis creation tools for posts, recordings, captions, and civic content.",
    eyebrow: "Create",
    headline: "Opening the creator",
    supportingCopy:
      "Prepare posts, recordings, captions, media, and publishing controls from the browser.",
  },
  {
    filename: "discover/index.html",
    route: "/discover",
    routeKey: "discover",
    title: "Discover | Polis",
    description: "Open Polis discovery for candidates, campaigns, coalitions, events, topics, and search.",
    eyebrow: "Discover",
    headline: "Opening civic discovery",
    supportingCopy:
      "Browse candidates, coalitions, events, topics, policy questions, and people from the browser.",
  },
  {
    filename: "achievements/index.html",
    route: "/achievements",
    routeKey: "achievements",
    title: "Achievements | Polis",
    description: "Open Polis achievements, civic progress, and participation milestones.",
    eyebrow: "Achievements",
    headline: "Opening your progress",
    supportingCopy:
      "Review participation progress, badges, streaks, and achievement context from the browser.",
  },
  {
    filename: "search/index.html",
    route: "/search",
    routeKey: "search",
    title: "Search | Polis",
    description: "Search Polis posts, people, tags, campaigns, coalitions, and events.",
    eyebrow: "Search",
    headline: "Opening search",
    supportingCopy:
      "Search posts, people, tags, campaigns, coalitions, events, and civic content from the browser.",
  },
  {
    filename: "candidates/index.html",
    route: "/candidates",
    routeKey: "candidates",
    title: "Candidates | Polis",
    description: "Open candidate profiles, report cards, elections, and candidate-related civic context in Polis.",
    eyebrow: "Candidates",
    headline: "Opening candidates",
    supportingCopy:
      "Browse candidates, official profiles, report cards, elections, and campaign context from the browser.",
  },
  {
    filename: "officials/index.html",
    route: "/officials",
    title: "Officials | Polis",
    description: "Open elected-official profiles, report cards, and vote context in Polis.",
    eyebrow: "Officials",
    headline: "Opening officials",
    supportingCopy:
      "Review official profiles, congressional report cards, votes, and public-accountability context from the browser.",
  },
  {
    filename: "auto-candidates/index.html",
    route: "/auto-candidates",
    title: "Candidate | Polis",
    description: "Open automatically matched candidate and official profile context in Polis.",
    eyebrow: "Candidate",
    headline: "Opening candidate context",
    supportingCopy:
      "Load candidate and official context, report-card information, and related civic activity from the browser.",
  },
  {
    filename: "candidate/voter-map/index.html",
    route: "/candidate/voter-map",
    routeKey: "candidate-voter-map",
    title: "Candidate Voter Map | Polis",
    description: "Open candidate voter-map tools, outreach views, registry context, and field workflows in Polis.",
    eyebrow: "Voter Map",
    headline: "Opening the voter map",
    supportingCopy:
      "Review voter-map tools, outreach paths, registry context, and field workflows from the browser.",
  },
  {
    filename: "missions/index.html",
    route: "/missions",
    routeKey: "missions",
    title: "Missions | Polis",
    description: "Open Polis missions, assignments, claim flows, review queues, and staff task context.",
    eyebrow: "Missions",
    headline: "Opening missions",
    supportingCopy:
      "Track mission details, claims, role-based assignments, approvals, files, and deadlines from the browser.",
  },
  {
    filename: "events/index.html",
    route: "/events",
    routeKey: "events",
    title: "Events | Polis",
    description: "Open Polis events, RSVPs, signup flows, calendars, maps, and event management tools.",
    eyebrow: "Events",
    headline: "Opening events",
    supportingCopy:
      "Browse event details, RSVPs, signup flows, maps, calendar context, and event management tools from the browser.",
  },
  {
    filename: "manage-events/index.html",
    route: "/manage-events",
    routeKey: "manage-events",
    title: "Manage Events | Polis",
    description: "Open Polis event creation and management tools for campaign and coalition work.",
    eyebrow: "Manage Events",
    headline: "Opening event management",
    supportingCopy:
      "Create, edit, review, and coordinate events for campaign and coalition work from the browser.",
  },
  {
    filename: "profile/index.html",
    route: "/profile",
    routeKey: "profile-self",
    title: "Profile | Polis",
    description: "Open Polis profiles, notifications, connections, and profile editing tools.",
    eyebrow: "Profile",
    headline: "Opening your profile",
    supportingCopy:
      "Review profile details, notifications, connections, public activity, and profile editing tools from the browser.",
  },
  {
    filename: "settings/index.html",
    route: "/settings",
    routeKey: "settings",
    title: "Settings | Polis",
    description: "Open Polis account, privacy, security, profile, notifications, and voter-intelligence settings.",
    eyebrow: "Settings",
    headline: "Opening settings",
    supportingCopy:
      "Manage account, privacy, security, profile, notifications, voter intelligence, and connected services from the browser.",
  },
  {
    filename: "onboarding/index.html",
    route: "/onboarding/profile",
    title: "Onboarding | Polis",
    description: "Open Polis onboarding for profile, photo, topics, location, and district setup.",
    eyebrow: "Onboarding",
    headline: "Opening onboarding",
    supportingCopy:
      "Finish profile, photo, topic, location, district, and first-run setup from the browser.",
  },
  {
    filename: "topics/index.html",
    route: "/topics",
    routeKey: "topics",
    title: "Topics | Polis",
    description: "Open Polis topic selection and civic-interest preferences.",
    eyebrow: "Topics",
    headline: "Opening topics",
    supportingCopy:
      "Choose civic topics, interests, and discovery preferences from the browser.",
  },
  {
    filename: "questions/index.html",
    route: "/questions",
    routeKey: "policy-questions",
    title: "Policy Questions | Polis",
    description: "Open Polis policy questions, answers, ballot-guide progress, and voter-intelligence signals.",
    eyebrow: "Policy Questions",
    headline: "Opening policy questions",
    supportingCopy:
      "Answer policy questions, compare issue context, and build voter-intelligence signals from the browser.",
  },
  {
    filename: "auth/index.html",
    route: "/auth",
    routeKey: "auth",
    title: "Account | Polis",
    description: "Open Polis account sign-in, sign-up, password reset, and account recovery flows.",
    eyebrow: "Account",
    headline: "Opening your account",
    supportingCopy:
      "Use sign-in, sign-up, verification, password reset, and account recovery tools from the browser.",
    requiresAuth: false,
  },
  {
    filename: "auth/signup/email/index.html",
    route: "/auth/signup/email",
    routeKey: "auth",
    title: "Create Account | Polis",
    description: "Create a Polis account from the browser.",
    eyebrow: "Account",
    headline: "Create your Polis account",
    supportingCopy:
      "Start sign-up, verify your account, and continue into the Polis web app.",
    requiresAuth: false,
  },
  {
    filename: "auth/signup/password/index.html",
    route: "/auth/signup/password",
    routeKey: "auth",
    title: "Create Account | Polis",
    description: "Continue creating a Polis account from the browser.",
    eyebrow: "Account",
    headline: "Create your Polis account",
    supportingCopy:
      "Finish sign-up, verify your account, and continue into the Polis web app.",
    requiresAuth: false,
  },
  {
    filename: "auth/confirm-code/index.html",
    route: "/auth/confirm-code",
    routeKey: "auth",
    title: "Confirm Account | Polis",
    description: "Confirm a Polis account verification code from the browser.",
    eyebrow: "Account",
    headline: "Confirm your Polis account",
    supportingCopy:
      "Enter your verification code and continue into the Polis web app.",
    requiresAuth: false,
  },
  {
    filename: "auth/forgot-password/index.html",
    route: "/auth/forgot-password",
    routeKey: "auth",
    title: "Reset Password | Polis",
    description: "Request a Polis password reset code from the browser.",
    eyebrow: "Account",
    headline: "Reset your password",
    supportingCopy:
      "Request a reset code, set a new password, and return to your Polis account.",
    requiresAuth: false,
  },
  {
    filename: "auth/forgot-password/confirm/index.html",
    route: "/auth/forgot-password/confirm",
    routeKey: "auth",
    title: "Reset Password | Polis",
    description: "Confirm a Polis password reset code from the browser.",
    eyebrow: "Account",
    headline: "Reset your password",
    supportingCopy:
      "Confirm your reset code, set a new password, and return to your Polis account.",
    requiresAuth: false,
  },
  {
    filename: "social-return/index.html",
    route: "/social-return",
    routeKey: "settings-section",
    routeParams: { settingsPath: "connected-accounts" },
    title: "Connected Accounts | Polis",
    description: "Return to Polis connected-account settings after a social account connection.",
    eyebrow: "Connected Accounts",
    headline: "Returning to connected accounts",
    supportingCopy:
      "Review the social account connection result and continue managing publishing targets from the browser.",
  },
  {
    filename: "oauth/complete/index.html",
    route: "/oauth/complete",
    routeKey: "settings-section",
    routeParams: { settingsPath: "connected-accounts" },
    title: "Connected Accounts | Polis",
    description: "Return to Polis connected-account settings after an OAuth connection.",
    eyebrow: "Connected Accounts",
    headline: "Returning to connected accounts",
    supportingCopy:
      "Review the OAuth connection result and continue managing publishing targets from the browser.",
  },
  {
    filename: "calendar-return/index.html",
    route: "/calendar-return",
    routeKey: "settings-section",
    routeParams: { settingsPath: "connected-accounts" },
    title: "Calendar Connected | Polis",
    description: "Return to Polis after connecting a calendar account.",
    eyebrow: "Calendar",
    headline: "Returning from calendar setup",
    supportingCopy:
      "Review the calendar connection result and continue managing account or campaign calendar tools from the browser.",
  },
  {
    filename: "account-deletion-requested/index.html",
    route: "/account-deletion-requested",
    routeKey: "account-deletion-requested",
    title: "Account Deletion Requested | Polis",
    description: "Review Polis account deletion request status.",
    eyebrow: "Account",
    headline: "Account deletion requested",
    supportingCopy:
      "Review the account deletion request status and next steps from the browser.",
    requiresAuth: false,
  },
  {
    filename: "admin/index.html",
    route: "/admin",
    routeKey: "admin",
    title: "Admin | Polis",
    description: "Open Polis admin review, catalog, moderation, and operational tools.",
    eyebrow: "Admin",
    headline: "Opening admin tools",
    supportingCopy:
      "Review admin dashboards, moderation queues, catalog settings, policy questions, and operational tools from the browser.",
  },
];

const sharedAppRouteRewrites = [
  [/^\/auth\/signup\/email(?:\/.*)?$/u, "/auth/signup/email/index.html"],
  [/^\/auth\/signup\/password(?:\/.*)?$/u, "/auth/signup/password/index.html"],
  [/^\/auth\/confirm-code(?:\/.*)?$/u, "/auth/confirm-code/index.html"],
  [/^\/auth\/forgot-password\/confirm(?:\/.*)?$/u, "/auth/forgot-password/confirm/index.html"],
  [/^\/auth\/forgot-password(?:\/.*)?$/u, "/auth/forgot-password/index.html"],
  [/^\/auth(?:\/.*)?$/u, "/auth/index.html"],
  [/^\/social-return(?:\/.*)?$/u, "/social-return/index.html"],
  [/^\/oauth\/complete(?:\/.*)?$/u, "/oauth/complete/index.html"],
  [/^\/calendar-return(?:\/.*)?$/u, "/calendar-return/index.html"],
  [/^\/settings\/voter-intelligence(?:\/.*)?$/u, "/settings/voter-intelligence/index.html"],
  [/^\/messages(?:\/.*)?$/u, "/messages/index.html"],
  [/^\/candidate-dashboard(?:\/.*)?$/u, "/candidate-dashboard/index.html"],
  [/^\/coalitions(?:\/.*)?$/u, "/coalitions/index.html"],
  [/^\/cta-invite(?:\/.*)?$/u, "/cta-invite/index.html"],
  [/^\/election-day(?:\/.*)?$/u, "/election-day/index.html"],
  [/^\/feed(?:\/.*)?$/u, "/feed/index.html"],
  [/^\/posts(?:\/.*)?$/u, "/posts/index.html"],
  [/^\/create(?:\/.*)?$/u, "/create/index.html"],
  [/^\/create-tab$/u, "/create/index.html"],
  [/^\/discover(?:\/.*)?$/u, "/discover/index.html"],
  [/^\/achievements(?:\/.*)?$/u, "/achievements/index.html"],
  [/^\/search(?:\/.*)?$/u, "/search/index.html"],
  [/^\/candidates(?:\/.*)?$/u, "/candidates/index.html"],
  [/^\/officials(?:\/.*)?$/u, "/officials/index.html"],
  [/^\/auto-candidates(?:\/.*)?$/u, "/auto-candidates/index.html"],
  [/^\/candidate\/voter-map(?:\/.*)?$/u, "/candidate/voter-map/index.html"],
  [/^\/missions(?:\/.*)?$/u, "/missions/index.html"],
  [/^\/events(?:\/.*)?$/u, "/events/index.html"],
  [/^\/manage-events(?:\/.*)?$/u, "/manage-events/index.html"],
  [/^\/profile(?:\/.*)?$/u, "/profile/index.html"],
  [/^\/profile-tab$/u, "/profile/index.html"],
  [/^\/settings(?:\/.*)?$/u, "/settings/index.html"],
  [/^\/onboarding(?:\/.*)?$/u, "/onboarding/index.html"],
  [/^\/topics(?:\/.*)?$/u, "/topics/index.html"],
  [/^\/questions(?:\/.*)?$/u, "/questions/index.html"],
  [/^\/auth\/forgot-password(?:\/.*)?$/u, "/auth/index.html"],
  [/^\/account-deletion-requested$/u, "/account-deletion-requested/index.html"],
  [/^\/admin(?:\/.*)?$/u, "/admin/index.html"],
].map(([from, to]) => ({ from, to }));

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
    staticSettingsVoterIntelligenceShell("settings/voter-intelligence/index.html"),
    staticMessagesShell("messages.html"),
    staticMessagesShell("messages/index.html"),
    staticCandidateDashboardShell("candidate-dashboard.html"),
    staticCandidateDashboardShell("candidate-dashboard/index.html"),
    staticCoalitionsShell("coalitions.html"),
    staticCoalitionsShell("coalitions/index.html"),
    ...sharedAppShells.map((shell) =>
      staticSharedAppShell(shell.filename, shell),
    ),
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
    historyApiFallback: {
      rewrites: sharedAppRouteRewrites,
    },
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
