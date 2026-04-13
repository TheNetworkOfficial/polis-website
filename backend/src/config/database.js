const { Sequelize } = require("sequelize");
const path = require("path");
require("dotenv").config();

const isProduction = process.env.NODE_ENV === "production";
let sequelize;

if (process.env.DB_SQLITE_PATH) {
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.resolve(process.env.DB_SQLITE_PATH),
    logging: false,
  });
}

// If a dialect is supplied via environment variables, use the provided
// database connection details. Otherwise fall back to an in-memory SQLite
// instance so the app can run without a full database setup.
else if (process.env.DB_DIALECT) {
  const dialectOpts = isProduction
    ? {
        ssl: {
          require: true,
          rejectUnauthorized: false,
        },
      }
    : {};

  sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USERNAME,
    process.env.DB_PASSWORD,
    {
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      dialect: process.env.DB_DIALECT,
      logging: false,
      dialectOptions: dialectOpts,
    },
  );
} else {
  sequelize = new Sequelize("sqlite::memory:", { logging: false });
}

module.exports = sequelize;
