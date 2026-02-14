const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

const NewsArticle = sequelize.define(
  "NewsArticle",
  {
    title: { type: DataTypes.STRING, allowNull: false },
    url: { type: DataTypes.STRING, allowNull: false },
    summary: { type: DataTypes.TEXT },
    thumbnailImage: { type: DataTypes.STRING },
    backupImage: { type: DataTypes.STRING },
  },
  {
    tableName: "news_articles",
    timestamps: true,
  },
);

module.exports = NewsArticle;
